import { z } from "zod";

import type { ProviderToolCall } from "../providers/types";
import { InspectGitChangesError } from "./inspect-git-changes";
import { ReadTextFileError } from "./read-text-file";
import { getHostTool, getRegisteredTool, type HostToolName } from "./tool-registry";
import { WorkspaceToolError } from "./workspace-policy";

export const MAX_TOOL_OUTPUT_BYTES = 256 * 1024;

export interface ToolExecutionResult {
  content: string;
  isError: boolean;
  durationMs: number;
}

function serializeError(error: unknown): string {
  if (
    error instanceof ReadTextFileError ||
    error instanceof WorkspaceToolError ||
    error instanceof InspectGitChangesError
  ) {
    return JSON.stringify({ ok: false, error: { code: error.code, message: error.message } });
  }
  if (error instanceof z.ZodError) {
    return JSON.stringify({
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "Tool arguments did not match the schema." },
    });
  }
  if (error instanceof SyntaxError) {
    return JSON.stringify({
      ok: false,
      error: { code: "INVALID_JSON", message: "Tool arguments were not valid JSON." },
    });
  }
  return JSON.stringify({
    ok: false,
    error: { code: "TOOL_FAILED", message: "The tool could not complete the request." },
  });
}

async function executeRegisteredTool(
  workspaceRoot: string,
  toolName: string,
  rawArguments: unknown,
  audience: "repository_agent_v1" | "host_change_acquisition_v1",
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const startedAt = performance.now();
  try {
    const tool =
      audience === "repository_agent_v1"
        ? getRegisteredTool(toolName)
        : getHostTool(toolName);
    if (!tool || tool.audience !== audience) {
      throw new WorkspaceToolError(
        "INVALID_ARGUMENT",
        `Tool ${toolName || "<unnamed>"} is not available.`,
      );
    }
    const result = await tool.invoke({ workspaceRoot, signal }, rawArguments);
    const content = JSON.stringify({ ok: true, ...result });
    if (Buffer.byteLength(content, "utf8") > MAX_TOOL_OUTPUT_BYTES) {
      return {
        content: JSON.stringify({
          ok: false,
          error: {
            code: "OUTPUT_TOO_LARGE",
            message: `Tool output exceeded the ${MAX_TOOL_OUTPUT_BYTES}-byte gateway limit. Narrow the request.`,
          },
        }),
        isError: true,
        durationMs: performance.now() - startedAt,
      };
    }
    return { content, isError: false, durationMs: performance.now() - startedAt };
  } catch (error) {
    return {
      content: serializeError(error),
      isError: true,
      durationMs: performance.now() - startedAt,
    };
  }
}

export async function executeToolCall(
  workspaceRoot: string,
  toolCall: ProviderToolCall,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  try {
    const rawArguments = JSON.parse(toolCall.function.arguments) as unknown;
    return executeRegisteredTool(
      workspaceRoot,
      toolCall.function.name,
      rawArguments,
      "repository_agent_v1",
      signal,
    );
  } catch (error) {
    return {
      content: serializeError(error),
      isError: true,
      durationMs: 0,
    };
  }
}

export function executeHostToolCall(
  workspaceRoot: string,
  toolName: HostToolName,
  rawArguments: unknown,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  return executeRegisteredTool(
    workspaceRoot,
    toolName,
    rawArguments,
    "host_change_acquisition_v1",
    signal,
  );
}

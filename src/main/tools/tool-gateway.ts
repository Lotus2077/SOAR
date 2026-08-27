import { z } from "zod";

import type { ProviderToolCall } from "../providers/types";
import { ReadTextFileError, readTextFile } from "./read-text-file";

const readTextFileArgumentsSchema = z
  .object({
    relativePath: z.string().trim().min(1).max(4_096),
  })
  .strict();

export interface ToolExecutionResult {
  content: string;
  isError: boolean;
  durationMs: number;
}

function serializeError(error: unknown): string {
  if (error instanceof ReadTextFileError) {
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

export async function executeToolCall(
  workspaceRoot: string,
  toolCall: ProviderToolCall,
): Promise<ToolExecutionResult> {
  const startedAt = performance.now();

  try {
    if (toolCall.function.name !== "read_text_file") {
      throw new ReadTextFileError(
        "INVALID_ARGUMENT",
        `Tool ${toolCall.function.name || "<unnamed>"} is not available.`,
      );
    }

    const args = readTextFileArgumentsSchema.parse(JSON.parse(toolCall.function.arguments));
    const result = await readTextFile({ workspaceRoot, relativePath: args.relativePath });
    return {
      content: JSON.stringify({ ok: true, ...result }),
      isError: false,
      durationMs: performance.now() - startedAt,
    };
  } catch (error) {
    return {
      content: serializeError(error),
      isError: true,
      durationMs: performance.now() - startedAt,
    };
  }
}

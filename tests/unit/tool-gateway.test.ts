import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ProviderToolCall } from "../../src/main/providers/types";
import { executeToolCall } from "../../src/main/tools/tool-gateway";

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "soar-tool-gateway-"));
  temporaryDirectories.push(workspaceRoot);
  return workspaceRoot;
}

function toolCall(name: string, args: string): ProviderToolCall {
  return {
    id: "call-1",
    type: "function",
    function: { name, arguments: args },
  };
}

function parsedContent(result: Awaited<ReturnType<typeof executeToolCall>>): Record<string, unknown> {
  return JSON.parse(result.content) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("executeToolCall", () => {
  it("executes read_text_file and returns a structured result", async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(path.join(workspaceRoot, "note.txt"), "hello\n", "utf8");

    const result = await executeToolCall(
      workspaceRoot,
      toolCall("read_text_file", JSON.stringify({ relativePath: "note.txt" })),
    );

    expect(result.isError).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(parsedContent(result)).toEqual({
      ok: true,
      text: "hello\n",
      bytes: 6,
      truncated: false,
    });
  });

  it("returns INVALID_JSON for malformed serialized arguments", async () => {
    const workspaceRoot = await createWorkspace();

    const result = await executeToolCall(
      workspaceRoot,
      toolCall("read_text_file", '{"relativePath":'),
    );

    expect(result.isError).toBe(true);
    expect(parsedContent(result)).toEqual({
      ok: false,
      error: {
        code: "INVALID_JSON",
        message: "Tool arguments were not valid JSON.",
      },
    });
  });

  it.each([
    ["missing relativePath", {}],
    ["non-string relativePath", { relativePath: 42 }],
    ["unknown argument", { relativePath: "note.txt", unexpected: true }],
  ])("returns INVALID_ARGUMENT for %s", async (_label, args) => {
    const workspaceRoot = await createWorkspace();

    const result = await executeToolCall(
      workspaceRoot,
      toolCall("read_text_file", JSON.stringify(args)),
    );

    expect(result.isError).toBe(true);
    expect(parsedContent(result)).toEqual({
      ok: false,
      error: {
        code: "INVALID_ARGUMENT",
        message: "Tool arguments did not match the schema.",
      },
    });
  });

  it("rejects unknown tool names without executing their arguments", async () => {
    const workspaceRoot = await createWorkspace();

    const result = await executeToolCall(
      workspaceRoot,
      toolCall("run_shell", JSON.stringify({ command: "echo should-not-run" })),
    );

    expect(result.isError).toBe(true);
    expect(parsedContent(result)).toEqual({
      ok: false,
      error: {
        code: "INVALID_ARGUMENT",
        message: "Tool run_shell is not available.",
      },
    });
  });
});

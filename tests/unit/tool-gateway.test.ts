import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import type { ProviderToolCall } from "../../src/main/providers/types";
import {
  executeToolCall,
  executeHostToolCall,
  MAX_TOOL_OUTPUT_BYTES,
} from "../../src/main/tools/tool-gateway";
import { MODEL_TOOL_DEFINITIONS } from "../../src/main/tools/tool-registry";

const execFileAsync = promisify(execFile);

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

  it("dispatches list_files and search_text through the central registry", async () => {
    const workspaceRoot = await createWorkspace();
    await mkdir(path.join(workspaceRoot, "src"));
    await writeFile(path.join(workspaceRoot, "src", "index.ts"), "line one\nexport const marker = 1;\n", "utf8");

    const listed = await executeToolCall(
      workspaceRoot,
      toolCall("list_files", JSON.stringify({ relativePath: "src" })),
    );
    const searched = await executeToolCall(
      workspaceRoot,
      toolCall("search_text", JSON.stringify({ query: "marker" })),
    );

    expect(listed.isError).toBe(false);
    expect(parsedContent(listed)).toMatchObject({
      ok: true,
      entries: [{ path: "src/index.ts", type: "file" }],
      truncated: false,
    });
    expect(searched.isError).toBe(false);
    expect(parsedContent(searched)).toMatchObject({
      ok: true,
      matches: [
        {
          path: "src/index.ts",
          lineNumber: 2,
          text: "export const marker = 1;",
        },
      ],
      truncated: false,
    });
  });

  it("passes cancellation through every registered tool", async () => {
    const workspaceRoot = await createWorkspace();
    const controller = new AbortController();
    controller.abort();

    const result = await executeToolCall(
      workspaceRoot,
      toolCall("list_files", "{}"),
      controller.signal,
    );

    expect(result.isError).toBe(true);
    expect(parsedContent(result)).toEqual({
      ok: false,
      error: { code: "CANCELLED", message: "Tool execution was cancelled." },
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

  it("fails closed when JSON escaping expands a tool result past the gateway cap", async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(
      path.join(workspaceRoot, "escape-heavy.txt"),
      "\\".repeat(Math.floor(MAX_TOOL_OUTPUT_BYTES / 2)),
      "utf8",
    );

    const result = await executeToolCall(
      workspaceRoot,
      toolCall(
        "read_text_file",
        JSON.stringify({ relativePath: "escape-heavy.txt" }),
      ),
    );

    expect(result.isError).toBe(true);
    expect(Buffer.byteLength(result.content, "utf8")).toBeLessThan(
      MAX_TOOL_OUTPUT_BYTES,
    );
    expect(parsedContent(result)).toEqual({
      ok: false,
      error: {
        code: "OUTPUT_TOO_LARGE",
        message:
          `Tool output exceeded the ${MAX_TOOL_OUTPUT_BYTES}-byte gateway limit. Narrow the request.`,
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

  it("keeps change acquisition host-only while dispatching it through the same gateway", async () => {
    const workspaceRoot = await createWorkspace();
    await execFileAsync("/usr/bin/git", ["init", "--quiet"], { cwd: workspaceRoot });
    await execFileAsync("/usr/bin/git", ["config", "user.name", "SOAR Test"], {
      cwd: workspaceRoot,
    });
    await execFileAsync(
      "/usr/bin/git",
      ["config", "user.email", "soar@example.invalid"],
      { cwd: workspaceRoot },
    );
    await writeFile(path.join(workspaceRoot, "tracked.txt"), "base\n");
    await execFileAsync("/usr/bin/git", ["add", "tracked.txt"], { cwd: workspaceRoot });
    await execFileAsync("/usr/bin/git", ["commit", "--quiet", "-m", "base"], {
      cwd: workspaceRoot,
    });

    expect(
      MODEL_TOOL_DEFINITIONS.flatMap((definition) =>
        definition.type === "function" ? [definition.function.name] : [],
      ),
    ).not.toContain("inspect_git_changes");
    const modelAttempt = await executeToolCall(
      workspaceRoot,
      toolCall(
        "inspect_git_changes",
        JSON.stringify({ schemaVersion: "inspect-git-changes-v1" }),
      ),
    );
    expect(modelAttempt.isError).toBe(true);
    expect(parsedContent(modelAttempt)).toMatchObject({
      error: { code: "INVALID_ARGUMENT" },
    });

    const hostResult = await executeHostToolCall(
      workspaceRoot,
      "inspect_git_changes",
      { schemaVersion: "inspect-git-changes-v1" },
    );
    expect(hostResult.isError).toBe(false);
    expect(parsedContent(hostResult)).toMatchObject({
      ok: true,
      schemaVersion: "inspect-git-changes-result-v1",
      snapshot: { manifest: [] },
    });
  });
});

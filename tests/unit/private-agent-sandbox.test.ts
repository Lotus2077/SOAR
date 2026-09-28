import { describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { DockerSandbox, SandboxError } from "../../src/main/private-agent/sandbox";

vi.mock("node:child_process", () => ({ spawn: vi.fn(() => { throw new Error("No subprocess is allowed in validation tests"); }) }));
const imageId = "sha256:" + "a".repeat(64);
const input = () => ({ imageId, jobId: "synthetic-job", contextId: "synthetic-context", files: [] as { path: string; bytes: Buffer }[] });

describe("private sandbox host admission", () => {
  it.each(["python:latest", "sha256:abc", "sha256:" + "A".repeat(64), "sha256:" + "a".repeat(64) + "\n"])("rejects mutable or malformed image %s before Docker", async imageId => {
    await expect(DockerSandbox.create({ ...input(), imageId })).rejects.toMatchObject({ code: "invalid_input" });
    expect(spawn).not.toHaveBeenCalled();
  });
  it.each(["../secret", "/absolute", "a/../b", "a//b", "./b", "a\\b", "a\nb", "a\0b", "a/", "x".repeat(241), "\ud800", Array(34).fill("a").join("/")])("rejects unsafe import path %j before Docker", async path => {
    await expect(DockerSandbox.create({ ...input(), files: [{ path, bytes: Buffer.from("synthetic") }] })).rejects.toMatchObject({ code: "invalid_input" });
    expect(spawn).not.toHaveBeenCalled();
  });
  it("rejects duplicate files and file/directory collisions before Docker", async () => {
    for (const paths of [["same", "same"], ["parent", "parent/child"]]) {
      await expect(DockerSandbox.create({ ...input(), files: paths.map(path => ({ path, bytes: Buffer.alloc(0) })) })).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(spawn).not.toHaveBeenCalled();
  });
  it("rejects excessive file counts and non-buffer data before Docker", async () => {
    await expect(DockerSandbox.create({ ...input(), files: Array.from({ length: 1025 }, (_, n) => ({ path: `f${n}`, bytes: Buffer.alloc(0) })) })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(DockerSandbox.create({ ...input(), files: [{ path: "file", bytes: "bad" as unknown as Buffer }] })).rejects.toMatchObject({ code: "invalid_input" });
    expect(spawn).not.toHaveBeenCalled();
  });
  it("rejects caller identity syntax rather than passing it to Docker", async () => {
    await expect(DockerSandbox.create({ ...input(), contextId: "invalid\ncontext" })).rejects.toMatchObject({ code: "invalid_input" });
    expect(spawn).not.toHaveBeenCalled();
  });
  it("reports only a fixed safe error", () => {
    expect(new SandboxError("unsafe_file").message).toBe("Private sandbox: unsafe_file");
  });
  it.each([0, 1801, 1.5, Number.NaN])("rejects invalid independent lifetime %s before Docker", async lifetimeSeconds => {
    await expect(DockerSandbox.create({ ...input(), lifetimeSeconds })).rejects.toMatchObject({ code: "invalid_input" });
    expect(spawn).not.toHaveBeenCalled();
  });
  it.each(["tcp://127.0.0.1:2375", "ssh://example.invalid", "unix:///bad\npath"])("rejects nonlocal/malformed pinned endpoint %s", async endpoint => {
    await expect(DockerSandbox.create({ ...input(), endpoint })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(DockerSandbox.cleanupOwnedContext({ endpoint, jobId: "job", contextId: "context" })).rejects.toMatchObject({ code: "invalid_input" });
    expect(spawn).not.toHaveBeenCalled();
  });
});

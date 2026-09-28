import { randomUUID } from "node:crypto";
import { link, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
}));
vi.mock("electron", () => ({ dialog: electron.dialog, ipcMain: {
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => electron.handlers.set(channel, handler),
  removeHandler: (channel: string) => electron.handlers.delete(channel),
} }));

import { registerGeneralTaskIpc } from "../../src/main/general-tasks-ipc";
import type { GeneralTaskController } from "../../src/main/general-tasks/controller";
import type { CredentialIpcAuthority } from "../../src/main/ipc";
import { GENERAL_TASK_IPC_CHANNELS as channels } from "../../src/shared/general-task-contracts";

const id = randomUUID(), selectionId = randomUUID();
const sha256 = "a".repeat(64);
const ref = { id, path: "output/report.html", sha256 };
const input = { goal: "Summarize the synthetic fixture.", inputSelectionId: selectionId, outputName: "report.html", publicOrSynthetic: true };
const url = "file:///Applications/SOAR.app/renderer/index.html";
let allowed = true;
const frame = { url };
const sender = { mainFrame: frame, getURL: () => url, isDestroyed: () => false };
const event = { sender, senderFrame: frame };
const window = { webContents: sender, isDestroyed: () => false };
const authority = { expectedRendererUrl: url, currentWindow: () => allowed ? window : undefined } as unknown as CredentialIpcAuthority;
const controller = {
  availability: vi.fn(), selectInputs: vi.fn(), create: vi.fn(), list: vi.fn(), get: vi.fn(),
  start: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), artifact: vi.fn(), bundle: vi.fn(),
  previewConsultation: vi.fn(), decideConsultation: vi.fn(),
};
const roots: string[] = [];
let unregister: () => void;
function invoke(channel: string, value?: unknown, from: unknown = event): Promise<unknown> {
  return Promise.resolve().then(() => electron.handlers.get(channel)!(from, value));
}
async function temporaryFile(name = "export.html") {
  const root = await mkdtemp(path.join(tmpdir(), "soar-general-ipc-")); roots.push(root);
  return path.join(root, name);
}
beforeEach(() => {
  allowed = true;
  for (const mock of Object.values(controller)) mock.mockReset();
  for (const mock of Object.values(electron.dialog)) mock.mockReset();
  controller.artifact.mockResolvedValue({ bytes: Buffer.from("<script>not executed</script>"), path: ref.path, sha256 });
  unregister = registerGeneralTaskIpc({ controller: controller as unknown as GeneralTaskController, authority });
});
afterEach(async () => { unregister(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("general task host IPC boundary", () => {
  it("exports only a host-resolved bundle and rechecks its displayed manifest after the save dialog", async () => {
    const bundleRef = { id, manifestSha256: sha256 }, destination = await temporaryFile("all.zip");
    const bytes = Buffer.from([80, 75, 3, 4, 0, 255]);
    controller.bundle.mockResolvedValue({ bytes, manifestSha256: sha256 });
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
    await expect(invoke(channels.exportBundle, bundleRef)).resolves.toEqual({ exported: true, filePath: destination });
    expect(controller.bundle).toHaveBeenNthCalledWith(1, bundleRef);
    expect(controller.bundle).toHaveBeenNthCalledWith(2, bundleRef);
    expect(await readFile(destination)).toEqual(bytes);
    await writeFile(destination, "preserved");
    controller.bundle.mockResolvedValueOnce({ bytes }).mockRejectedValueOnce(new Error("general_task_bundle_stale"));
    await expect(invoke(channels.exportBundle, bundleRef)).rejects.toThrow("general_task_bundle_stale");
    expect(await readFile(destination, "utf8")).toBe("preserved");
    expect(controller.start).not.toHaveBeenCalled(); expect(controller.resume).not.toHaveBeenCalled();
  });

  it("rejects renderer bundle paths, revoked senders and native cancellation", async () => {
    const bundleRef = { id, manifestSha256: sha256 };
    for (const ref of [{ ...bundleRef, hostPath: "/tmp/zip" }, { ...bundleRef, paths: ["input/secret"] }, { ...bundleRef, manifestSha256: "bad" }])
      await expect(invoke(channels.exportBundle, ref)).rejects.toThrow("Invalid general-task request");
    expect(controller.bundle).not.toHaveBeenCalled();
    controller.bundle.mockResolvedValue({ bytes: Buffer.from("archive"), manifestSha256: sha256 });
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    await expect(invoke(channels.exportBundle, bundleRef)).resolves.toEqual({ exported: false });
    const destination = await temporaryFile("all.zip"); await writeFile(destination, "preserved");
    electron.dialog.showSaveDialog.mockImplementationOnce(async () => { allowed = false; return { canceled: false, filePath: destination }; });
    await expect(invoke(channels.exportBundle, bundleRef)).rejects.toThrow("unavailable from this renderer");
    expect(await readFile(destination, "utf8")).toBe("preserved");
  });

  it("passes only exact consultation references/decisions and never implicitly resumes", async () => {
    const proposal = { id, proposalId: randomUUID(), proposalSha256: sha256 };
    await invoke(channels.previewConsultation, proposal);
    expect(controller.previewConsultation).toHaveBeenCalledExactlyOnceWith(proposal);
    for (const decision of ["approve", "decline", "revoke"] as const) await invoke(channels.decideConsultation, { ...proposal, decision });
    expect(controller.decideConsultation).toHaveBeenCalledTimes(3);
    expect(controller.resume).not.toHaveBeenCalled(); expect(controller.start).not.toHaveBeenCalled();
    for (const invalid of [{ ...proposal, proposalSha256: "wrong" }, { ...proposal, proposalId: "../other" }, { ...proposal, packet: "renderer replacement" }, { ...proposal, maxFeeMicrousd: 1 }]) {
      await expect(invoke(channels.previewConsultation, invalid)).rejects.toThrow("Invalid general-task request");
      await expect(invoke(channels.decideConsultation, { ...invalid, decision: "approve" })).rejects.toThrow("Invalid general-task request");
    }
    await expect(invoke(channels.decideConsultation, { ...proposal, decision: "approve_and_resume" })).rejects.toThrow("Invalid general-task request");
    expect(controller.decideConsultation).toHaveBeenCalledTimes(3);
  });
  it("rejects every operation from a foreign sender, child frame or revoked window before effects", async () => {
    for (const channel of Object.values(channels).filter(value => value !== channels.update)) {
      for (const from of [{ ...event, sender: { ...sender } }, { ...event, senderFrame: { url } }]) {
        await expect(invoke(channel, undefined, from)).rejects.toThrow("unavailable from this renderer");
      }
      allowed = false;
      await expect(invoke(channel)).rejects.toThrow("unavailable from this renderer");
      allowed = true;
    }
    for (const mock of [...Object.values(controller), ...Object.values(electron.dialog)]) expect(mock).not.toHaveBeenCalled();
  });

  it("allows native-picked paths only and returns the host's opaque copy token", async () => {
    const selection = { id: selectionId, files: [{ path: "input/01-public.txt", name: "public.txt", bytes: 4, sha256 }] };
    electron.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/native/selected/public.txt"] });
    controller.selectInputs.mockReturnValue(selection);
    await expect(invoke(channels.chooseInputs, { paths: ["/renderer/private.txt"] })).rejects.toThrow("does not accept");
    expect(electron.dialog.showOpenDialog).not.toHaveBeenCalled();
    await expect(invoke(channels.chooseInputs)).resolves.toEqual(selection);
    expect(controller.selectInputs).toHaveBeenCalledExactlyOnceWith(["/native/selected/public.txt"]);
    expect(JSON.stringify(selection)).not.toContain("/native/");
  });

  it("does not import after native selection cancellation or authority loss during the dialog", async () => {
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(invoke(channels.chooseInputs)).resolves.toBeNull();
    electron.dialog.showOpenDialog.mockImplementationOnce(async () => {
      allowed = false; return { canceled: false, filePaths: ["/native/selected/public.txt"] };
    });
    await expect(invoke(channels.chooseInputs)).rejects.toThrow("unavailable from this renderer");
    expect(controller.selectInputs).not.toHaveBeenCalled();
  });

  it("requires explicit goal-and-file consent and excludes renderer paths, checks and configuration", async () => {
    for (const invalid of [{ ...input, publicOrSynthetic: false }, { ...input, publicOrSynthetic: undefined },
      { ...input, inputSelectionId: "/tmp/public.txt" }, { ...input, checks: [{ python: "print('forged')" }] },
      { ...input, files: ["/tmp/private.txt"] }, { ...input, model: "renderer-model" }, { ...input, outputName: "../escape.txt" }]) {
      await expect(invoke(channels.create, invalid)).rejects.toThrow("Invalid general-task request");
    }
    expect(controller.create).not.toHaveBeenCalled();
    await invoke(channels.create, input);
    expect(controller.create).toHaveBeenCalledExactlyOnceWith(input);
  });

  it("accepts only UUIDs for lifecycle actions and no arguments for list/readiness", async () => {
    for (const [channel, name] of [[channels.get, "get"], [channels.start, "start"], [channels.pause, "pause"], [channels.resume, "resume"], [channels.cancel, "cancel"]] as const) {
      await expect(invoke(channel, { id, force: true })).rejects.toThrow("Invalid general-task request");
      await invoke(channel, id); expect(controller[name]).toHaveBeenCalledExactlyOnceWith(id);
    }
    for (const channel of [channels.list, channels.availability]) await expect(invoke(channel, {})).rejects.toThrow("does not accept");
  });

  it("rejects traversal, foreign host paths and renderer-added export locations before artifact access", async () => {
    for (const invalid of [{ ...ref, path: "/tmp/private.txt" }, { ...ref, path: "output/../input/public.txt" },
      { ...ref, path: "output/a\\b" }, { ...ref, sha256: "wrong" }, { ...ref, hostPath: "/tmp/export" }]) {
      await expect(invoke(channels.readArtifact, invalid)).rejects.toThrow("Invalid general-task request");
      await expect(invoke(channels.exportArtifact, invalid)).rejects.toThrow("Invalid general-task request");
    }
    expect(controller.artifact).not.toHaveBeenCalled(); expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  it("passes the complete job/path/digest reference to the host and returns HTML as inert text", async () => {
    await expect(invoke(channels.readArtifact, ref)).resolves.toEqual({ ...ref, bytes: 29, kind: "text", text: "<script>not executed</script>", truncated: false });
    expect(controller.artifact).toHaveBeenCalledExactlyOnceWith(ref);
    controller.artifact.mockRejectedValueOnce(new Error("general_task_artifact_changed"));
    await expect(invoke(channels.exportArtifact, { ...ref, id: randomUUID() })).rejects.toThrow("general_task_artifact_changed");
    expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  it("bounds text previews and returns malformed or binary content as metadata only", async () => {
    for (const bytes of [Buffer.from([0xff]), Buffer.from([0]), Buffer.from("not a PDF")]) {
      const target = bytes.toString() === "not a PDF" ? { ...ref, path: "output/report.pdf" } : ref;
      controller.artifact.mockResolvedValueOnce({ bytes, path: target.path, sha256 });
      await expect(invoke(channels.readArtifact, target)).resolves.toMatchObject({ kind: "binary", text: null, truncated: false });
    }
    controller.artifact.mockResolvedValueOnce({ bytes: Buffer.alloc(128 * 1024 + 1, 65), path: ref.path, sha256 });
    const preview = await invoke(channels.readArtifact, ref) as { text: string; truncated: boolean; bytes: number };
    expect(preview.text).toHaveLength(128 * 1024); expect(preview.truncated).toBe(true); expect(preview.bytes).toBe(128 * 1024 + 1);
  });

  it("exports exact re-resolved bytes only to the native save destination", async () => {
    const destination = await temporaryFile();
    await writeFile(destination, "old contents that must be replaced completely");
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
    await expect(invoke(channels.exportArtifact, ref)).resolves.toEqual({ exported: true, filePath: destination });
    expect(controller.artifact).toHaveBeenCalledTimes(2);
    expect(await readFile(destination, "utf8")).toBe("<script>not executed</script>");
  });

  it("does not overwrite a target after snapshot drift or post-dialog authority revocation", async () => {
    const destination = await temporaryFile(); await writeFile(destination, "preserved");
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
    controller.artifact.mockResolvedValueOnce({ bytes: Buffer.from("old"), path: ref.path, sha256 }).mockRejectedValueOnce(new Error("general_task_artifact_changed"));
    await expect(invoke(channels.exportArtifact, ref)).rejects.toThrow("general_task_artifact_changed");
    expect(await readFile(destination, "utf8")).toBe("preserved");
    controller.artifact.mockResolvedValue({ bytes: Buffer.from("new"), path: ref.path, sha256 });
    electron.dialog.showSaveDialog.mockImplementationOnce(async () => { allowed = false; return { canceled: false, filePath: destination }; });
    await expect(invoke(channels.exportArtifact, ref)).rejects.toThrow("unavailable from this renderer");
    expect(await readFile(destination, "utf8")).toBe("preserved");
  });

  it("never follows a save-target symlink or truncates a multiply-linked file", async () => {
    const destination = await temporaryFile(), original = `${destination}.original`;
    await writeFile(original, "preserved"); await symlink(original, destination);
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
    await expect(invoke(channels.exportArtifact, ref)).rejects.toThrow();
    expect(await readFile(original, "utf8")).toBe("preserved");
    await rm(destination); await link(original, destination);
    await expect(invoke(channels.exportArtifact, ref)).rejects.toThrow("regular file");
    expect(await readFile(original, "utf8")).toBe("preserved");
  });

  it("honors save cancellation and unregisters all request handlers", async () => {
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    await expect(invoke(channels.exportArtifact, ref)).resolves.toEqual({ exported: false });
    expect(controller.artifact).toHaveBeenCalledTimes(1);
    unregister(); expect(electron.handlers.size).toBe(0);
  });

  it("does not expose native save paths in filesystem failure messages", async () => {
    const destination = path.join(await temporaryFile("missing-parent"), "export.html");
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
    let message = "";
    try { await invoke(channels.exportArtifact, ref); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(message).not.toBe("");
    expect(message).not.toContain(destination);
    expect(message).not.toContain(path.dirname(destination));
  });
});

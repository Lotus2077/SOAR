import { constants } from "node:fs";
import { lstat, open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { dialog, ipcMain } from "electron";
import type { z } from "zod";
import {
  GENERAL_TASK_IPC_CHANNELS as channels,
  GeneralTaskArtifactRefSchema, GeneralTaskBundleRefSchema, GeneralTaskCreateInputSchema, GeneralTaskIdSchema,
  GeneralTaskConsultationRefSchema, GeneralTaskConsultationDecisionSchema,
  type GeneralTaskArtifactPreview,
} from "../shared/general-task-contracts";
import { assertCredentialIpcSender, type CredentialIpcAuthority } from "./ipc";
import type { GeneralTaskController } from "./general-tasks/controller";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("Invalid general-task request.");
  return result.data;
}
function noPayload(value: unknown): void {
  if (value !== undefined) throw new Error("This general-task action does not accept a payload.");
}

async function saveArtifactBytes(filePath: string, bytes: Buffer, assertCurrent: () => void): Promise<void> {
  // Write completely before replacing a native-dialog-approved destination.
  const temporary = path.join(path.dirname(filePath), `.soar-export-${randomUUID()}.tmp`);
  try {
    const original = await lstat(filePath).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (original && (!original.isFile() || original.isSymbolicLink() || original.nlink !== 1)) throw new Error("invalid_destination");
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    const current = await lstat(filePath).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (original ? !current || current.dev !== original.dev || current.ino !== original.ino || current.nlink !== 1 : current !== undefined) throw new Error("destination_changed");
    assertCurrent();
    await rename(temporary, filePath);
  } catch {
    throw new Error("The artifact could not be saved. Choose a writable regular file and try again.");
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}

/** The renderer never supplies a source or export host path. */
export function registerGeneralTaskIpc({ controller, authority }: {
  controller: GeneralTaskController; authority: CredentialIpcAuthority;
}): () => void {
  const handle = (channel: string, operation: (value: unknown, assertCurrent: () => void) => unknown) => {
    ipcMain.handle(channel, (event, value: unknown) => {
      assertCredentialIpcSender(event, authority);
      return operation(value, () => assertCredentialIpcSender(event, authority));
    });
  };
  handle(channels.availability, value => { noPayload(value); return controller.availability(); });
  handle(channels.chooseInputs, async (value, assertCurrent) => {
    noPayload(value);
    const result = await dialog.showOpenDialog({ title: "Choose public or synthetic inputs", buttonLabel: "Use files", properties: ["openFile", "multiSelections"] });
    assertCurrent();
    if (result.canceled || !result.filePaths.length) return null;
    return controller.selectInputs(result.filePaths);
  });
  handle(channels.create, value => controller.create(parse(GeneralTaskCreateInputSchema, value)));
  handle(channels.list, value => { noPayload(value); return controller.list(); });
  handle(channels.get, value => controller.get(parse(GeneralTaskIdSchema, value)));
  handle(channels.start, value => controller.start(parse(GeneralTaskIdSchema, value)));
  handle(channels.pause, value => controller.pause(parse(GeneralTaskIdSchema, value)));
  handle(channels.resume, value => controller.resume(parse(GeneralTaskIdSchema, value)));
  handle(channels.cancel, value => controller.cancel(parse(GeneralTaskIdSchema, value)));
  handle(channels.previewConsultation, value => controller.previewConsultation(parse(GeneralTaskConsultationRefSchema, value)));
  handle(channels.decideConsultation, value => controller.decideConsultation(parse(GeneralTaskConsultationDecisionSchema, value)));
  handle(channels.readArtifact, async value => {
    const ref = parse(GeneralTaskArtifactRefSchema, value);
    const artifact = await controller.artifact(ref);
    const maximum = 128 * 1024;
    const textExtension = /\.(?:md|markdown|txt|csv|tsv|json|html?|xml|ya?ml|log)$/iu.test(ref.path);
    let text: string | null = null;
    if (textExtension && !artifact.bytes.includes(0)) {
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes.subarray(0, maximum), { stream: artifact.bytes.length > maximum }); }
      catch { /* Binary and malformed UTF-8 stay metadata-only. */ }
    }
    return { ...ref, bytes: artifact.bytes.length, kind: text === null ? "binary" : "text", text,
      truncated: text !== null && artifact.bytes.length > maximum } satisfies GeneralTaskArtifactPreview;
  });
  handle(channels.exportArtifact, async (value, assertCurrent) => {
    const ref = parse(GeneralTaskArtifactRefSchema, value);
    // Resolve before showing a native dialog and again after its asynchronous wait.
    await controller.artifact(ref);
    const result = await dialog.showSaveDialog({ title: "Export task artifact", defaultPath: path.basename(ref.path) });
    assertCurrent();
    if (result.canceled || !result.filePath) return { exported: false };
    const artifact = await controller.artifact(ref);
    await saveArtifactBytes(result.filePath, artifact.bytes, assertCurrent);
    return { exported: true, filePath: result.filePath };
  });
  handle(channels.exportBundle, async (value, assertCurrent) => {
    const ref = parse(GeneralTaskBundleRefSchema, value);
    await controller.bundle(ref);
    const result = await dialog.showSaveDialog({ title: "Export all task files", defaultPath: "task-files.zip",
      filters: [{ name: "ZIP archive", extensions: ["zip"] }] });
    assertCurrent();
    if (result.canceled || !result.filePath) return { exported: false };
    const archive = await controller.bundle(ref);
    await saveArtifactBytes(result.filePath, archive.bytes, assertCurrent);
    return { exported: true, filePath: result.filePath };
  });
  return () => { for (const channel of Object.values(channels)) if (channel !== channels.update) ipcMain.removeHandler(channel); };
}

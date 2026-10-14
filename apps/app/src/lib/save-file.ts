import {
  fileTransferChunkResultSchema,
  fileTransferStartResultSchema,
  saveFileResultSchema,
  type SaveFileSupport,
} from "@bb/mobile-bridge";
import type { z } from "zod";
import { appToast } from "@/components/ui/app-toast";
import {
  getNativeShell,
  type NativeShell,
} from "@/lib/native-shell/native-shell";

const OBJECT_URL_REVOKE_DELAY_MS = 60_000;

export type SaveFileRequest =
  | { fileName: string; url: string }
  | { fileName: string; blob: Blob };

export type SaveFileOutcome = "started" | "saved" | "dismissed" | "failed";

export type NativeSaveSource =
  | { kind: "server-url"; url: string }
  | { kind: "page-url"; url: string }
  | { kind: "blob"; blob: Blob }
  | { kind: "anchor" };

export function resolveNativeSaveSource(
  request: SaveFileRequest,
  pageHref: string,
): NativeSaveSource {
  if ("blob" in request) return { kind: "blob", blob: request.blob };
  let target: URL;
  try {
    target = new URL(request.url, pageHref);
  } catch {
    return { kind: "anchor" };
  }
  if (target.protocol === "blob:" || target.protocol === "data:") {
    return { kind: "page-url", url: target.href };
  }
  if (
    (target.protocol === "http:" || target.protocol === "https:") &&
    target.origin === new URL(pageHref).origin
  ) {
    return { kind: "server-url", url: target.href };
  }
  return { kind: "anchor" };
}

function downloadWithAnchor(request: SaveFileRequest): void {
  const href =
    "blob" in request ? URL.createObjectURL(request.blob) : request.url;
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = request.fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  if ("blob" in request) {
    setTimeout(() => URL.revokeObjectURL(href), OBJECT_URL_REVOKE_DELAY_MS);
  }
}

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(blob);
  });
}

async function request<T>(
  shell: NativeShell,
  kind: string,
  payload: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const parsed = schema.safeParse(await shell.request(kind, payload));
  if (!parsed.success) throw new Error("The app returned an unexpected reply");
  return parsed.data;
}

async function transferBlob(
  shell: NativeShell,
  support: SaveFileSupport,
  blob: Blob,
): Promise<string> {
  if (blob.size > support.maxTransferBytes) {
    throw new Error("This file is too large to save on this device");
  }
  const { transferId } = await request(
    shell,
    "file-transfer-start",
    { size: blob.size },
    fileTransferStartResultSchema,
  );
  for (let offset = 0; offset < blob.size; offset += support.chunkBytes) {
    const data = await readBase64(
      blob.slice(offset, offset + support.chunkBytes),
    );
    await request(
      shell,
      "file-transfer-chunk",
      { transferId, offset, data },
      fileTransferChunkResultSchema,
    );
  }
  return transferId;
}

async function fetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  return response.blob();
}

async function saveWithNativeShell(
  shell: NativeShell,
  support: SaveFileSupport,
  fileName: string,
  source: Exclude<NativeSaveSource, { kind: "anchor" }>,
): Promise<"saved" | "dismissed"> {
  const nativeSource =
    source.kind === "server-url"
      ? { kind: "url", url: source.url }
      : {
          kind: "transfer",
          transferId: await transferBlob(
            shell,
            support,
            source.kind === "blob" ? source.blob : await fetchBlob(source.url),
          ),
        };
  const { outcome } = await request(
    shell,
    "save-file",
    { fileName, source: nativeSource },
    saveFileResultSchema,
  );
  return outcome;
}

function describeSaveError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Something went wrong while saving the file.";
}

export function canSaveFileNatively(): boolean {
  return getNativeShell()?.handshake.saveFile !== undefined;
}

export async function saveFile(
  saveRequest: SaveFileRequest,
): Promise<SaveFileOutcome> {
  const shell = getNativeShell();
  const support = shell?.handshake.saveFile;
  const source =
    shell === null || support === undefined
      ? ({ kind: "anchor" } as const)
      : resolveNativeSaveSource(saveRequest, window.location.href);
  if (shell === null || support === undefined || source.kind === "anchor") {
    downloadWithAnchor(saveRequest);
    return "started";
  }
  try {
    return await saveWithNativeShell(
      shell,
      support,
      saveRequest.fileName,
      source,
    );
  } catch (error) {
    appToast.error(`Couldn't save ${saveRequest.fileName}`, {
      description: describeSaveError(error),
    });
    return "failed";
  }
}

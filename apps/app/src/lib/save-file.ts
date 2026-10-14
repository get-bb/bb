import { appToast } from "@/components/ui/app-toast";
import { getNativeShell } from "@/lib/native-shell/native-shell";

const OBJECT_URL_REVOKE_DELAY_MS = 60_000;

export type SaveFileRequest =
  | { fileName: string; url: string }
  | { fileName: string; blob: Blob };

export type SaveFileOutcome = "started" | "failed";

export function canSaveFileNatively(): boolean {
  return getNativeShell()?.handshake.nativeDownloads === true;
}

export async function saveFile(
  request: SaveFileRequest,
): Promise<SaveFileOutcome> {
  let objectUrl: string | null = null;
  try {
    const href =
      "blob" in request
        ? (objectUrl = URL.createObjectURL(request.blob))
        : request.url;
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = request.fileName;
    anchor.rel = "noopener";
    document.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
    return "started";
  } catch (error) {
    appToast.error(`Couldn't save ${request.fileName}`, {
      description:
        error instanceof Error
          ? error.message
          : "Could not start the download.",
    });
    return "failed";
  } finally {
    if (objectUrl !== null) {
      const href = objectUrl;
      setTimeout(() => URL.revokeObjectURL(href), OBJECT_URL_REVOKE_DELAY_MS);
    }
  }
}

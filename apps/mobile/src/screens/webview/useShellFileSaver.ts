import {
  SAVE_FILE_SUPPORT,
  type SaveFilePayload,
  type SaveFileResult,
} from "@bb/mobile-bridge";
import CookieManager from "@react-native-cookies/cookies";
import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useMemo, useRef } from "react";
import { Platform, Share } from "react-native";
import { describeError } from "@/lib/describe-error";
import {
  buildCookieHeader,
  createFileTransferRegistry,
  describeDownloadFailure,
  resolveServerFileUrl,
  sanitizeSaveFileName,
  type FileTransferSink,
} from "@/lib/shell";
import { toast } from "@/ui";

const SAVES_DIRECTORY_NAME = "bb-shell-files";
const MAX_CONCURRENT_TRANSFERS = 4;
const TRANSFER_IDLE_MS = 60_000;
const TRANSFER_PART_NAME = "transfer.part";

export const SHELL_SAVE_FILE_SUPPORT =
  Platform.OS === "ios" ? SAVE_FILE_SUPPORT : null;

interface DiskTransferSink extends FileTransferSink {
  directory: Directory;
  part: File;
}

export interface ShellFileSaver {
  startTransfer(size: number): string;
  appendTransfer(transferId: string, offset: number, data: string): number;
  save(payload: SaveFilePayload): Promise<SaveFileResult>;
  saveStrayDownload(url: string): void;
}

function savesRoot(): Directory {
  return new Directory(Paths.cache, SAVES_DIRECTORY_NAME);
}

function deleteQuietly(entry: Directory | File): void {
  try {
    if (entry.exists) entry.delete();
  } catch {
    return;
  }
}

function createSaveDirectory(name: string): Directory {
  const directory = new Directory(savesRoot(), name);
  directory.create({ intermediates: true });
  return directory;
}

async function cookieHeaderFor(url: string): Promise<string | null> {
  try {
    return buildCookieHeader(await CookieManager.get(url, true));
  } catch {
    return null;
  }
}

export function useShellFileSaver(serverUrl: string): ShellFileSaver {
  const presenting = useRef(false);
  const downloadCount = useRef(0);
  const registry = useMemo(
    () =>
      createFileTransferRegistry<DiskTransferSink>({
        maxTransfers: MAX_CONCURRENT_TRANSFERS,
        idleMs: TRANSFER_IDLE_MS,
        now: Date.now,
      }),
    [],
  );

  useEffect(() => {
    deleteQuietly(savesRoot());
    return () => {
      registry.clear();
      deleteQuietly(savesRoot());
    };
  }, [registry]);

  return useMemo(() => {
    const download = async (
      url: string,
      fileName: string | null,
    ): Promise<{ directory: Directory; file: File }> => {
      const resolved = resolveServerFileUrl(url, serverUrl);
      if (resolved === null) {
        throw new Error("Only files from this server can be saved");
      }
      downloadCount.current += 1;
      const directory = createSaveDirectory(
        `d${downloadCount.current.toString(36)}_${Date.now().toString(36)}`,
      );
      try {
        const cookie = await cookieHeaderFor(resolved);
        const file = await File.downloadFileAsync(
          resolved,
          fileName === null
            ? directory
            : new File(directory, sanitizeSaveFileName(fileName)),
          {
            idempotent: true,
            headers: cookie === null ? {} : { Cookie: cookie },
          },
        );
        return { directory, file };
      } catch (error) {
        deleteQuietly(directory);
        throw new Error(describeDownloadFailure(describeError(error)));
      }
    };

    const present = async (
      prepare: () => Promise<{ directory: Directory; file: File }>,
    ): Promise<SaveFileResult> => {
      if (presenting.current) {
        throw new Error("Another file is already being saved");
      }
      presenting.current = true;
      let directory: Directory | null = null;
      try {
        const prepared = await prepare();
        directory = prepared.directory;
        const result = await Share.share({ url: prepared.file.uri });
        return {
          outcome:
            result.action === Share.dismissedAction ? "dismissed" : "saved",
        };
      } finally {
        presenting.current = false;
        if (directory !== null) deleteQuietly(directory);
      }
    };

    return {
      startTransfer: (size) =>
        registry.start(size, (transferId) => {
          const directory = createSaveDirectory(transferId);
          const part = new File(directory, TRANSFER_PART_NAME);
          part.create();
          return {
            directory,
            part,
            append: (data) =>
              part.write(data, { encoding: "base64", append: true }),
            discard: () => deleteQuietly(directory),
          };
        }),
      appendTransfer: (transferId, offset, data) =>
        registry.append(transferId, offset, data),
      save: (payload) => {
        const { source } = payload;
        if (source.kind === "url") {
          return present(() => download(source.url, payload.fileName));
        }
        return present(async () => {
          const sink = registry.finish(source.transferId);
          const name = sanitizeSaveFileName(payload.fileName);
          try {
            sink.part.rename(name);
          } catch (error) {
            sink.discard();
            throw error;
          }
          return {
            directory: sink.directory,
            file: new File(sink.directory, name),
          };
        });
      },
      saveStrayDownload: (url) => {
        void present(() => download(url, null)).catch((error: unknown) => {
          toast.error("Couldn't save the file", {
            description: describeError(error),
          });
        });
      },
    };
  }, [registry, serverUrl]);
}

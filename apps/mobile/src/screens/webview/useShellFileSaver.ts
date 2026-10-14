import { File } from "expo-file-system";
import { useCallback, useRef } from "react";
import { Platform, Share } from "react-native";
import RNCWebViewModule from "react-native-webview/lib/NativeRNCWebViewModule";
import { supportsNativeDownloads } from "@/lib/shell";
import type { FileDownload } from "react-native-webview";
import { describeError } from "@/lib/describe-error";
import { toast } from "@/ui";

export const SHELL_NATIVE_DOWNLOADS_SUPPORTED =
  Platform.OS === "ios" && supportsNativeDownloads(RNCWebViewModule);

type FileDownloadEvent = { nativeEvent: FileDownload };

export function useShellFileSaver(): (event: FileDownloadEvent) => void {
  const presenting = useRef(false);

  return useCallback((event: FileDownloadEvent) => {
    const { filePath, error } = event.nativeEvent;
    if (error) {
      toast.error("Couldn't save the file", { description: error });
      return;
    }
    if (!filePath) return;
    const present = async (): Promise<void> => {
      const file = new File(filePath);
      try {
        if (presenting.current) {
          throw new Error("Another file is already being saved");
        }
        presenting.current = true;
        try {
          await Share.share({ url: file.uri });
        } finally {
          presenting.current = false;
        }
      } finally {
        if (file.parentDirectory.exists) file.parentDirectory.delete();
      }
    };
    void present().catch((failure: unknown) => {
      toast.error("Couldn't save the file", {
        description: describeError(failure),
      });
    });
  }, []);
}

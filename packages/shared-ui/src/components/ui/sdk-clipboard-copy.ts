import { useCallback } from "react";
import { toast } from "sonner";
import { experimental_copyToClipboard } from "@get-bb/plugin-sdk/app";
import { useCopiedFeedback } from "./copy-button";

export function useSdkClipboardCopy({
  text,
  successMessage = null,
  errorMessage = "Failed to copy",
}: {
  text: string;
  successMessage?: string | null;
  errorMessage?: string;
}) {
  const { copied, markCopied } = useCopiedFeedback();
  const copy = useCallback(async () => {
    if (!text || copied) return;
    if (await experimental_copyToClipboard({ text })) {
      markCopied();
      if (successMessage !== null) toast.success(successMessage);
    } else {
      toast.error(errorMessage);
    }
  }, [copied, errorMessage, markCopied, successMessage, text]);
  return { copied, copy };
}

export async function copyTextWithSdkToast(
  text: string,
  {
    successMessage = "Copied",
    errorMessage = "Failed to copy",
  }: { successMessage?: string; errorMessage?: string } = {},
): Promise<boolean> {
  if (await experimental_copyToClipboard({ text })) {
    toast.success(successMessage);
    return true;
  }
  toast.error(errorMessage);
  return false;
}

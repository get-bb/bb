export interface CopyToClipboardOptions {
  successMessage?: string | null;
  errorMessage?: string | null;
  imageUrl?: string;
}

export function createClipboardCopyWithToast({
  copyText,
  copyTextAndImage,
  toast,
}: {
  copyText: (input: { text: string }) => Promise<boolean>;
  copyTextAndImage?: (text: string, imageUrl: string) => Promise<boolean>;
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
  };
}) {
  return async function copyToClipboardWithToast(
    text: string,
    {
      successMessage = "Copied",
      errorMessage = "Failed to copy",
      imageUrl,
    }: CopyToClipboardOptions = {},
  ): Promise<boolean> {
    const copied =
      imageUrl && copyTextAndImage
        ? await copyTextAndImage(text, imageUrl)
        : await copyText({ text });
    if (copied) {
      if (successMessage) toast.success(successMessage);
      return true;
    }
    if (imageUrl && text && (await copyText({ text }))) {
      toast.success("Copied text; image could not be copied");
      return true;
    }
    if (errorMessage) toast.error(errorMessage);
    return false;
  };
}

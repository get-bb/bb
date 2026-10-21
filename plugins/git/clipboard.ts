import { createClipboardCopyWithToast } from "@bb/shared-ui/clipboard";
import { experimental_copyToClipboard } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
export const copyToClipboardWithToast = createClipboardCopyWithToast({
  copyText: experimental_copyToClipboard,
  toast,
});

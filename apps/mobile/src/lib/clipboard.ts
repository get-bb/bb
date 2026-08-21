import * as Clipboard from "expo-clipboard";
import { toast } from "@/ui";

/** Copy `text` to the clipboard and toast the outcome. */
export function copyWithToast(text: string, successLabel: string): void {
  void Clipboard.setStringAsync(text)
    .then(() => toast.success(successLabel))
    .catch(() => toast.error("Could not copy"));
}

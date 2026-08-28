import * as Clipboard from "expo-clipboard";
import { toast } from "@/ui";

export function copyWithToast(text: string, successLabel: string): void {
  void Clipboard.setStringAsync(text)
    .then(() => toast.success(successLabel))
    .catch(() => toast.error("Could not copy"));
}

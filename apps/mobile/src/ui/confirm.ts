import { Alert } from "react-native";
import { haptic } from "@/lib/haptics";

export interface ConfirmDestructiveOptions {
  title: string;
  message?: string;
  /** The red button ("Delete", "Remove machine"). */
  actionLabel: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  onConfirm: () => void;
  /** Runs when the user cancels or dismisses the dialog. */
  onCancel?: () => void;
}

/**
 * System confirmation for a destructive action: a native alert with Cancel
 * and a destructive button, preceded by the warning haptic. Replaces the
 * "sheet with one red row" pattern; works identically on Android.
 */
export function confirmDestructive({
  title,
  message,
  actionLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDestructiveOptions): void {
  haptic("warning");
  Alert.alert(
    title,
    message,
    [
      { text: cancelLabel, style: "cancel", onPress: onCancel },
      { text: actionLabel, style: "destructive", onPress: onConfirm },
    ],
    // Android: the back button / outside tap dismisses like Cancel.
    { cancelable: true, onDismiss: onCancel },
  );
}

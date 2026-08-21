import { useMemo } from "react";
import { toast as sonnerToast, Toaster as SonnerToaster } from "sonner-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Icon } from "./Icon";

export type ToastId = string | number;

export interface ToastOptions {
  description?: string;
  /** Milliseconds; defaults to the Toaster's duration. */
  duration?: number;
  action?: { label: string; onClick: () => void };
  /**
   * Reuse an id to update a toast in place (a `loading` toast that turns
   * into `success` / `error` once the request settles).
   */
  id?: ToastId;
}

function show(
  kind: "success" | "error" | "info" | "warning" | "message" | "loading",
  message: string,
  options?: ToastOptions,
): ToastId {
  const data = {
    description: options?.description,
    duration: options?.duration,
    action: options?.action,
    id: options?.id,
  };
  switch (kind) {
    case "success":
      return sonnerToast.success(message, data);
    case "error":
      return sonnerToast.error(message, data);
    case "info":
      return sonnerToast.info(message, data);
    case "warning":
      return sonnerToast.warning(message, data);
    case "loading":
      return sonnerToast.loading(message, data);
    default:
      return sonnerToast(message, data);
  }
}

/** Imperative toasts; render one `<Toaster />` inside the ThemeProvider. */
export const toast = {
  message: (message: string, options?: ToastOptions) =>
    show("message", message, options),
  success: (message: string, options?: ToastOptions) =>
    show("success", message, options),
  error: (message: string, options?: ToastOptions) =>
    show("error", message, options),
  info: (message: string, options?: ToastOptions) =>
    show("info", message, options),
  warning: (message: string, options?: ToastOptions) =>
    show("warning", message, options),
  /** Spinner toast that stays until updated (pass its id) or dismissed. */
  loading: (message: string, options?: ToastOptions) =>
    show("loading", message, options),
  dismiss: (id?: ToastId) => sonnerToast.dismiss(id),
};

/** Themed sonner-native host. Place once, after the navigator. */
export function Toaster() {
  const { tokens, mode, radii, fonts } = useTheme();
  const icons = useMemo(
    () => ({
      success: <Icon name="CircleCheck" size={18} color={tokens.success} />,
      error: <Icon name="CircleX" size={18} color={tokens.destructiveText} />,
      warning: (
        <Icon name="AlertTriangle" size={18} color={tokens.warningText} />
      ),
      info: <Icon name="Info" size={18} color={tokens.timelineAccent} />,
    }),
    [tokens],
  );
  return (
    <SonnerToaster
      theme={mode}
      position="top-center"
      swipeToDismissDirection="up"
      duration={4000}
      visibleToasts={3}
      icons={icons}
      toastOptions={{
        style: {
          backgroundColor: tokens.popover,
          borderColor: tokens.border,
          borderWidth: 1,
          borderRadius: radii.lg,
        },
        titleStyle: {
          color: tokens.foreground,
          fontFamily: fonts.sans.medium,
          fontSize: 15,
        },
        descriptionStyle: {
          color: tokens.mutedForeground,
          fontFamily: fonts.sans.regular,
          fontSize: 14,
        },
        actionButtonStyle: {
          backgroundColor: tokens.foreground,
          borderRadius: radii.md,
        },
        actionButtonTextStyle: {
          color: tokens.background,
          fontFamily: fonts.sans.medium,
        },
      }}
    />
  );
}

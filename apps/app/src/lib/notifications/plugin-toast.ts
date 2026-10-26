import type { ReactNode } from "react";
import type {
  Action,
  ExternalToast,
  toast as sonnerToastFunction,
} from "sonner";
import {
  appToast,
  type AppToastOptions,
  type AppToastTone,
} from "@/components/ui/app-toast";
import { withSonnerToast } from "@/components/ui/app-toast-runtime";

type SonnerToast = typeof sonnerToastFunction;
type ToastTitle = Parameters<SonnerToast>[0];
type PromiseResult<Data> =
  | ReactNode
  | ((data: Data) => ReactNode | Promise<ReactNode>);
type PromiseOptions<Data> = Omit<ExternalToast, "description"> & {
  loading?: ReactNode;
  success?: PromiseResult<Data>;
  error?: PromiseResult<unknown>;
  description?: PromiseResult<unknown>;
  finally?: () => void | Promise<void>;
};

function resolveNode(value: ReactNode | (() => ReactNode)): ReactNode {
  return typeof value === "function" ? value() : value;
}

function isAction(value: ReactNode | Action): value is Action {
  return (
    typeof value === "object" &&
    value !== null &&
    "label" in value &&
    "onClick" in value &&
    typeof value.onClick === "function"
  );
}

function toAppToastOptions(
  data: ExternalToast | undefined,
): AppToastOptions | null {
  if (data === undefined) return {};
  const {
    action,
    cancel,
    className,
    classNames,
    description,
    dismissible,
    duration,
    id,
    invert,
    onAutoClose,
    onDismiss,
    position,
    richColors,
    style,
    unstyled,
  } = data;
  if (
    (action !== undefined && !isAction(action)) ||
    (cancel !== undefined && !isAction(cancel))
  ) {
    return null;
  }
  return {
    ...(action !== undefined ? { action } : {}),
    ...(cancel !== undefined ? { cancel } : {}),
    ...(className !== undefined ? { className } : {}),
    ...(classNames !== undefined ? { classNames } : {}),
    ...(description !== undefined
      ? { description: resolveNode(description) }
      : {}),
    ...(dismissible !== undefined ? { dismissible } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(invert !== undefined ? { invert } : {}),
    ...(onAutoClose !== undefined ? { onAutoClose } : {}),
    ...(onDismiss !== undefined ? { onDismiss } : {}),
    ...(position !== undefined ? { position } : {}),
    ...(richColors !== undefined ? { richColors } : {}),
    ...(style !== undefined ? { style } : {}),
    ...(unstyled !== undefined ? { unstyled } : {}),
  };
}

const SONNER_METHODS = {
  message: "message",
  success: "success",
  warning: "warning",
  error: "error",
  loading: "loading",
} as const satisfies Record<AppToastTone, keyof SonnerToast>;

let nextPromiseToastId = 0;
let nextRawToastId = 0;

export function createPluginToast(sonnerToast: SonnerToast): SonnerToast {
  const toneMethod =
    (tone: AppToastTone) =>
    (title: ToastTitle, data?: ExternalToast): string | number => {
      const options = toAppToastOptions(data);
      if (options !== null) return appToast[tone](resolveNode(title), options);
      const id = data?.id ?? `plugin-raw-toast-${(nextRawToastId += 1)}`;
      withSonnerToast(() => {
        sonnerToast[SONNER_METHODS[tone]](title, { ...data, id });
      }, id);
      return id;
    };
  const message = toneMethod("message");
  const promise = <Data>(
    input: Promise<Data> | (() => Promise<Data>),
    data: PromiseOptions<Data> = {},
  ): { unwrap: () => Promise<Data> } => {
    const {
      loading,
      success,
      error,
      description: _description,
      finally: onFinally,
      ...rest
    } = data;
    const options = {
      ...rest,
      id: data.id ?? `plugin-promise-toast-${(nextPromiseToastId += 1)}`,
    };
    if (loading !== undefined) toneMethod("loading")(loading, options);
    const pending = typeof input === "function" ? input() : input;
    const settle = async <Value>(
      tone: "success" | "error",
      result: PromiseResult<Value>,
      value: Value,
    ) => {
      const title = typeof result === "function" ? await result(value) : result;
      if (title === undefined) appToast.dismiss(options.id);
      else toneMethod(tone)(title, options);
    };
    void pending
      .then(
        (value) => settle("success", success, value),
        (reason: unknown) => settle("error", error, reason),
      )
      .finally(() => onFinally?.());
    return { unwrap: () => pending };
  };
  return Object.assign(message, {
    message,
    info: message,
    success: toneMethod("success"),
    warning: toneMethod("warning"),
    error: toneMethod("error"),
    loading: toneMethod("loading"),
    dismiss: (id?: number | string) => {
      appToast.dismiss(id);
      return id ?? "";
    },
    promise,
    custom: (
      render: Parameters<SonnerToast["custom"]>[0],
      data?: ExternalToast,
    ) => {
      const id = data?.id ?? `plugin-raw-toast-${(nextRawToastId += 1)}`;
      withSonnerToast(() => {
        sonnerToast.custom(render, { ...data, id });
      }, id);
      return id;
    },
    getHistory: sonnerToast.getHistory,
    getToasts: sonnerToast.getToasts,
  });
}

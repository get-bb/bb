import { extractErrorMessage } from "@bb/core-ui";
import { BbHttpError } from "@bb/sdk/browser";
import { z } from "zod";
import { appToast } from "@/components/ui/app-toast";
import { HttpError } from "./api";
import {
  describeLifecycleError,
  formatLifecycleErrorDescription,
  type LifecycleErrorOperation,
} from "./lifecycle-errors";

const HTTP_STATUS_PREFIX_PATTERN = /^HTTP \d{3}:\s*/u;
const NETWORK_TRANSPORT_ERROR_MESSAGE =
  "Could not reach the server. Check that it is running and try again.";
const GENERIC_REQUEST_FAILED_MESSAGE = "Request failed";
const TRAILING_PERIOD_PATTERN = /\.$/u;

interface MutationErrorMessageOptions {
  error: unknown;
  fallbackMessage: string;
  lifecycleOperation?: LifecycleErrorOperation | undefined;
}

interface MutationErrorMeta {
  errorMessage?: string;
  lifecycleOperation?: LifecycleErrorOperation;
  showErrorToast?: boolean;
}

interface MutationErrorMetaInput {
  errorMessage?: string | number;
  lifecycleOperation?: string;
  showErrorToast?: boolean | string;
}

const errorCauseSchema = z.object({
  message: z.string().optional(),
  name: z.string().optional(),
});

const mutationErrorMetaSchema = z.object({
  errorMessage: z.string().optional(),
  lifecycleOperation: z.string().optional(),
  showErrorToast: z.boolean().optional(),
});

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

function stripHttpStatusPrefix(message: string): string {
  return message.replace(HTTP_STATUS_PREFIX_PATTERN, "");
}

function stripTrailingPeriod(message: string): string {
  return message.replace(TRAILING_PERIOD_PATTERN, "");
}

function parseErrorCause(cause: unknown) {
  const parsed = errorCauseSchema.safeParse(cause);
  if (parsed.success) {
    return parsed.data;
  }
  if (cause instanceof Error) {
    return { message: cause.message, name: cause.name };
  }
  return null;
}

function isAbortLikeError(cause: unknown): boolean {
  return parseErrorCause(cause)?.name === "AbortError";
}

function isNetworkTransportError(cause: unknown): boolean {
  if (
    cause instanceof HttpError ||
    cause instanceof BbHttpError ||
    isAbortLikeError(cause)
  ) {
    return false;
  }

  const parsed = parseErrorCause(cause);
  if (parsed?.message === undefined) {
    return false;
  }

  const normalizedMessage = normalizeMessage(parsed.message).toLowerCase();
  return (
    normalizedMessage.includes("failed to fetch") ||
    normalizedMessage.includes("load failed") ||
    normalizedMessage.includes("networkerror")
  );
}

function toLifecycleErrorOperation(
  value: string | undefined,
): LifecycleErrorOperation | undefined {
  switch (value) {
    case "archive_thread":
    case "commit":
    case "create_thread":
    case "edit_message":
    case "load_diff":
    case "load_git_status":
    case "load_thread_storage":
    case "open_terminal":
    case "queue_message":
    case "reorder_queued_message":
    case "resolve_interaction":
    case "send_message":
    case "send_queued_message":
    case "set_queued_message_group_boundary":
    case "squash_merge":
    case "stop_thread":
    case "update_queued_message":
    case "update_merge_base":
      return value;
    default:
      return undefined;
  }
}

function getHttpErrorMessage(error: HttpError | BbHttpError): string | null {
  const bodyMessage = extractErrorMessage(error.body);
  if (bodyMessage) {
    return normalizeMessage(bodyMessage);
  }

  const strippedMessage = stripHttpStatusPrefix(
    normalizeMessage(error.message),
  );
  return strippedMessage.length > 0 ? strippedMessage : null;
}

export function getMutationErrorMeta(
  value: MutationErrorMetaInput | undefined,
): MutationErrorMeta {
  if (!value) {
    return {};
  }

  const parsed = mutationErrorMetaSchema.safeParse(value);
  if (!parsed.success) {
    return {};
  }

  const errorMessage =
    parsed.data.errorMessage === undefined
      ? undefined
      : normalizeMessage(parsed.data.errorMessage);
  const lifecycleOperation = toLifecycleErrorOperation(
    parsed.data.lifecycleOperation,
  );
  const result: MutationErrorMeta = {};
  if (errorMessage) {
    result.errorMessage = errorMessage;
  }
  if (lifecycleOperation) {
    result.lifecycleOperation = lifecycleOperation;
  }
  if (parsed.data.showErrorToast !== undefined) {
    result.showErrorToast = parsed.data.showErrorToast;
  }
  return result;
}

export function getMutationErrorMessage({
  error,
  fallbackMessage,
  lifecycleOperation,
}: MutationErrorMessageOptions): string {
  const lifecycleErrorDescription = describeLifecycleError({
    error,
    operation: lifecycleOperation,
  });
  if (lifecycleErrorDescription) {
    return formatLifecycleErrorDescription(lifecycleErrorDescription);
  }

  if (error instanceof HttpError || error instanceof BbHttpError) {
    return getHttpErrorMessage(error) ?? fallbackMessage;
  }

  if (isNetworkTransportError(error)) {
    return NETWORK_TRANSPORT_ERROR_MESSAGE;
  }

  const extractedMessage = extractErrorMessage(error);
  if (!extractedMessage) {
    return fallbackMessage;
  }

  const normalizedMessage = stripHttpStatusPrefix(
    normalizeMessage(extractedMessage),
  );
  return normalizedMessage.length > 0 ? normalizedMessage : fallbackMessage;
}

export function shouldShowMutationErrorToast(cause: unknown): boolean {
  return !isAbortLikeError(cause);
}

export function showMutationErrorToast({
  error,
  fallbackMessage,
  lifecycleOperation,
}: MutationErrorMessageOptions): void {
  if (!shouldShowMutationErrorToast(error)) {
    return;
  }

  const message = stripTrailingPeriod(
    getMutationErrorMessage({
      error,
      fallbackMessage,
      lifecycleOperation,
    }),
  );
  if (message === GENERIC_REQUEST_FAILED_MESSAGE) {
    appToast.error("Request failed", {
      description: "Please try again",
    });
    return;
  }

  appToast.error(message);
}

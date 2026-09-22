import { extractErrorMessage, toRecord } from "@bb/core-ui";

const NETWORK_TRANSPORT_ERROR_MESSAGE =
  "Could not reach the server. Check that it is running and try again.";

interface MutationErrorMessageOptions {
  error: unknown;
  fallbackMessage: string;
}

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

export function getErrorCode(error: unknown): string | null {
  const record = toRecord(error);
  return record !== null && typeof record.code === "string"
    ? record.code
    : null;
}

function isHttpError(error: unknown): boolean {
  const record = toRecord(error);
  return record !== null && typeof record.status === "number";
}

function isNetworkTransportError(error: unknown): boolean {
  if (isHttpError(error) || toRecord(error)?.name === "AbortError") {
    return false;
  }
  const record = toRecord(error);
  if (!record || typeof record.message !== "string") {
    return false;
  }
  const normalizedMessage = normalizeMessage(record.message).toLowerCase();
  return (
    normalizedMessage.includes("failed to fetch") ||
    normalizedMessage.includes("load failed") ||
    normalizedMessage.includes("networkerror")
  );
}

export function getMutationErrorMessage({
  error,
  fallbackMessage,
}: MutationErrorMessageOptions): string {
  if (isNetworkTransportError(error)) {
    return NETWORK_TRANSPORT_ERROR_MESSAGE;
  }
  const extractedMessage = extractErrorMessage(error);
  if (!extractedMessage) {
    return fallbackMessage;
  }
  const normalizedMessage = normalizeMessage(extractedMessage);
  return normalizedMessage.length > 0 ? normalizedMessage : fallbackMessage;
}

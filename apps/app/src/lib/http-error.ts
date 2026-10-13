import { extractErrorMessage } from "@bb/core-ui";
import { BbHttpError } from "@bb/sdk/browser";
import { HttpError } from "./api";

const HTTP_STATUS_PREFIX_PATTERN = /^HTTP \d{3}:\s*/u;

export function asHttpError(error: unknown): HttpError | BbHttpError | null {
  return error instanceof HttpError || error instanceof BbHttpError
    ? error
    : null;
}

export function getHttpErrorMessage(
  error: HttpError | BbHttpError,
): string | null {
  const bodyMessage = extractErrorMessage(error.body);
  if (bodyMessage) {
    return bodyMessage;
  }

  const normalizedMessage = extractErrorMessage(error.message);
  if (normalizedMessage === null) {
    return null;
  }
  const strippedMessage = normalizedMessage.replace(
    HTTP_STATUS_PREFIX_PATTERN,
    "",
  );
  return strippedMessage.length > 0 ? strippedMessage : null;
}

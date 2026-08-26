import { isLoopbackHostname } from "./loopback.js";

export function validateOptionalUrl(name: string, value: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return "";
  }
  return validateRequiredUrl(name, trimmedValue);
}

export function validateRequiredUrl(name: string, value: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`${name} must not be empty`);
  }

  try {
    void new URL(trimmedValue);
    return trimmedValue;
  } catch {
    throw new Error(`${name} must be a valid URL, received "${value}"`);
  }
}

/**
 * Validate a URL used to carry bb API credentials or workspace data.
 * Plain HTTP is safe only for loopback/local-development hostnames.
 */
export function validateServerUrl(name: string, value: string): string {
  const validated = validateRequiredUrl(name, value);
  const parsed = new URL(validated);
  if (parsed.protocol === "https:") {
    return validated;
  }
  const hostname = parsed.hostname.toLowerCase();
  const loopback =
    isLoopbackHostname(hostname) || hostname.endsWith(".localhost");
  if (parsed.protocol === "http:" && loopback) {
    return validated;
  }
  throw new Error(
    `${name} must use HTTPS unless it targets loopback/local development`,
  );
}

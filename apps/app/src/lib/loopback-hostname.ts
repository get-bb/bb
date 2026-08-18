const DECIMAL_OCTET_PATTERN = /^\d+$/u;

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

function isIpv4LoopbackHostname(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts[0] !== "127") {
    return false;
  }

  return parts.every((part) => {
    if (!DECIMAL_OCTET_PATTERN.test(part)) {
      return false;
    }
    const octet = Number(part);
    return octet >= 0 && octet <= 255 && String(octet) === part;
  });
}

/** Whether a browser-normalized hostname is reserved for local loopback. */
export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname === "::1" ||
    isIpv4LoopbackHostname(normalizedHostname)
  );
}

/**
 * Whether a hostname is loopback or unspecified (`0.0.0.0`, `::`,
 * `::ffff:127.x.x.x`). Such an address never routes to a remote machine: a
 * client that dials it reaches itself.
 */
export function isLocalOnlyHostname(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);
  if (isLoopbackHostname(normalizedHostname)) return true;
  if (normalizedHostname === "0.0.0.0" || normalizedHostname === "::") {
    return true;
  }
  // IPv4-mapped IPv6, dotted (`::ffff:127.0.0.1`) or hex (`::ffff:7f00:1`,
  // the form the URL parser emits).
  const dotted = normalizedHostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
  if (dotted !== null) return isLoopbackHostname(dotted[1] ?? "");
  const hex = normalizedHostname.match(
    /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u,
  );
  if (hex === null) return false;
  const high = Number.parseInt(hex[1] ?? "", 16);
  return high >> 8 === 127;
}

/** Whether a URL's hostname is loopback or unspecified. Invalid URLs are not. */
export function isLocalOnlyUrl(url: string): boolean {
  try {
    return isLocalOnlyHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function resolveLocalCloudLoopbackUrl(
  serverUrl: string | undefined,
  rawDevAppPort: string | undefined,
): string | null {
  if (!serverUrl || !rawDevAppPort) return null;
  const port = Number(rawDevAppPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;

  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return null;
  }
  const localCloud =
    url.protocol === "http:" && url.hostname.endsWith(".localhost");
  const stagingCloud =
    url.protocol === "https:" && url.hostname.endsWith(".vibecodethis.site");
  if (!localCloud && !stagingCloud) {
    return null;
  }
  return `http://127.0.0.1:${port}`;
}

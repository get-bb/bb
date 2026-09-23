const ALLOWED_PATH = /^\/api\/[A-Za-z0-9._~\-/]*$/u;

export class FetchPathError extends Error {
  constructor(path: string, reason: string) {
    super(
      `bb-account.v1.fetch refused path ${JSON.stringify(path)}: ${reason}`,
    );
    this.name = "FetchPathError";
  }
}

export function assertAllowedFetchPath(path: string): string {
  if (!path.startsWith("/api/")) {
    throw new FetchPathError(path, 'it must start with "/api/"');
  }
  if (path.includes("..")) {
    throw new FetchPathError(path, 'it must not contain ".."');
  }
  if (path.includes("//")) {
    throw new FetchPathError(path, 'it must not contain "//"');
  }
  if (path.includes("?") || path.includes("#")) {
    throw new FetchPathError(path, "it must not carry a query or fragment");
  }
  if (!ALLOWED_PATH.test(path)) {
    throw new FetchPathError(
      path,
      "it may only contain letters, digits, and - . _ ~ /",
    );
  }
  return path;
}

import { createHash } from "node:crypto";

export function localGitSourceRepoPath(urlish: string): string {
  const normalizedLocalPath = urlish
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\.git$/, "");
  if (process.platform !== "win32") {
    return normalizedLocalPath;
  }
  return createHash("sha256")
    .update(normalizedLocalPath.toLowerCase())
    .digest("hex");
}

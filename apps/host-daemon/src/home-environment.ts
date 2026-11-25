import { userInfo } from "node:os";

function accountHome(): string {
  try {
    return userInfo().homedir;
  } catch {
    return "";
  }
}

export function ensureHomeEnvironment(): void {
  if (process.platform === "win32" || process.env.HOME) return;
  const home = accountHome();
  if (home) process.env.HOME = home;
}

import { userInfo } from "node:os";

export function ensureHomeEnvironment(): void {
  if (process.platform !== "win32" && !process.env.HOME) {
    process.env.HOME = userInfo().homedir;
  }
}

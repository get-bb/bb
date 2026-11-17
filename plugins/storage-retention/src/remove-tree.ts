import fs from "node:fs/promises";
import path from "node:path";
import { isFsErrorWithCode } from "./fs-errors.js";

async function makeOwnerWritable(target: string): Promise<void> {
  const stats = await fs.lstat(target);
  if (stats.isSymbolicLink()) return;
  await fs.chmod(target, stats.mode | 0o700);
  if (!stats.isDirectory()) return;
  for (const name of await fs.readdir(target))
    await makeOwnerWritable(path.join(target, name));
}

export async function removeTree(target: string): Promise<void> {
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch (error) {
    if (
      !isFsErrorWithCode(error, "EACCES") &&
      !isFsErrorWithCode(error, "EPERM")
    )
      throw error;
    await makeOwnerWritable(target);
    await fs.rm(target, { recursive: true, force: true });
  }
}

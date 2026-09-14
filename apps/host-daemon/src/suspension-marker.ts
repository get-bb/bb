import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MACHINE_SUSPENSION_MARKER = "machine-suspended";

export async function hasMachineSuspensionMarker(
  dataDir: string,
): Promise<boolean> {
  try {
    await access(join(dataDir, MACHINE_SUSPENSION_MARKER));
    return true;
  } catch {
    return false;
  }
}

export async function writeMachineSuspensionMarker(
  dataDir: string,
): Promise<void> {
  await writeFile(join(dataDir, MACHINE_SUSPENSION_MARKER), "", {
    mode: 0o600,
  });
}

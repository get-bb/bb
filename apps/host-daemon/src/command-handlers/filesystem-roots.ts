import fs from "node:fs/promises";

const WINDOWS_DRIVE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const WINDOWS_DRIVE_PROBE_TIMEOUT_MS = 1_000;

interface ListFilesystemRootsOptions {
  platform: NodeJS.Platform;
  isDirectory: (path: string) => Promise<boolean>;
  probeTimeoutMs: number;
}

async function isAccessibleDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function probeWithTimeout(
  probe: Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([probe.catch(() => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function listFilesystemRoots({
  platform = process.platform,
  isDirectory = isAccessibleDirectory,
  probeTimeoutMs = WINDOWS_DRIVE_PROBE_TIMEOUT_MS,
}: Partial<ListFilesystemRootsOptions> = {}): Promise<string[]> {
  if (platform !== "win32") {
    return ["/"];
  }

  const driveRoots = [...WINDOWS_DRIVE_LETTERS].map((letter) => `${letter}:\\`);
  const available = await Promise.all(
    driveRoots.map((root) =>
      probeWithTimeout(isDirectory(root), probeTimeoutMs),
    ),
  );
  return driveRoots.filter((_, index) => available[index]);
}

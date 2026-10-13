import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const LEGACY_AUTOMATION_PARTITION_PREFIX = "bb-browser-automation-";

export async function removeLegacyAutomationPartitions(
  userDataPath: string,
): Promise<void> {
  const partitionsPath = join(userDataPath, "Partitions");
  const names = await readdir(partitionsPath).catch(() => []);
  await Promise.all(
    names
      .filter((name) => name.startsWith(LEGACY_AUTOMATION_PARTITION_PREFIX))
      .map((name) =>
        rm(join(partitionsPath, name), { recursive: true, force: true }),
      ),
  );
}

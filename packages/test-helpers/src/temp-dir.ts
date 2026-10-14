import { mkdtempSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

function removeAfterTest(directory: string): string {
  onTestFinished(() =>
    rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    }),
  );
  return directory;
}

export async function makeTempDir(prefix = "bb-test-"): Promise<string> {
  return removeAfterTest(await mkdtemp(join(tmpdir(), prefix)));
}

export function makeTempDirSync(prefix = "bb-test-"): string {
  return removeAfterTest(mkdtempSync(join(tmpdir(), prefix)));
}

import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { dispatchCommand } from "../../src/command-dispatch.js";
import {
  cleanupTempDirs,
  createHarness,
  makeTempDir,
} from "./dispatch-helpers.js";

afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanupTempDirs();
});
it("strips daemon-private inherited variables and returns clone failures as-is", async () => {
  const dir = await makeTempDir("bb-clone-private-");
  const helper = join(dir, "helper.sh");
  const capture = join(dir, "environment");
  await writeFile(
    helper,
    `env > '${capture}'\nprintf '%s\\n' "$CONTRIBUTED_SECRET" 'private-daemon-token' >&2\nexit 77\n`,
  );
  vi.stubEnv(
    "BB_SERVER_HEADERS",
    JSON.stringify({ "x-bb-connect-machine": "private-daemon-token" }),
  );
  vi.stubEnv("BB_PRIVATE_TEST", "other-daemon-private");
  const contributedEnv = Object.entries({
    GIT_SSH_COMMAND: `/bin/sh '${helper}'`,
    CONTRIBUTED_SECRET: "contributed-private",
  }).map(([name, value]) => ({
    name,
    value,
    source: { core: "machine-environment" as const },
    reason: "test",
  }));
  let failure = "";
  try {
    await dispatchCommand(
      {
        type: "project.clone",
        operationId: "private-clone",
        projectSlug: "test",
        remoteUrl: "ssh://git@invalid.example/repo",
        targetPath: join(dir, "clone"),
        contributedEnv,
      },
      createHarness().dispatchOptions({ dataDir: dir }),
    );
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  const environment = await readFile(capture, "utf8");
  expect(environment).not.toContain("BB_SERVER_HEADERS");
  expect(environment).not.toContain("BB_PRIVATE_TEST");
  expect(environment).toContain("CONTRIBUTED_SECRET=contributed-private");
  expect(failure).toContain("private-daemon-token");
  expect(failure).toContain("contributed-private");
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readCodexAuthCredentials } from "./codex-auth.js";

const tempDirs: string[] = [];

async function writeApiKeyAuth(
  codexHome: string,
  apiKey: string,
): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(
    path.join(codexHome, "auth.json"),
    JSON.stringify({
      auth_mode: "apikey",
      OPENAI_API_KEY: apiKey,
      tokens: null,
    }),
  );
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => fs.rm(tempDir, { force: true, recursive: true })),
  );
});

it("reads auth.json from CODEX_HOME when configured", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-codex-home-"));
  tempDirs.push(homeDir);
  const configuredCodexHome = path.join(homeDir, "custom-codex-home");
  await writeApiKeyAuth(path.join(homeDir, ".codex"), "default-api-key");
  await writeApiKeyAuth(configuredCodexHome, "configured-api-key");
  vi.stubEnv("HOME", homeDir);
  vi.stubEnv("CODEX_HOME", configuredCodexHome);

  await expect(readCodexAuthCredentials()).resolves.toEqual({
    type: "apiKey",
    apiKey: "configured-api-key",
  });
});

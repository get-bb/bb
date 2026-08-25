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

it("reports a missing auth.json as codex_auth_missing and an unparsable one as codex_auth_invalid", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-codex-home-"));
  tempDirs.push(homeDir);
  vi.stubEnv("HOME", homeDir);
  vi.stubEnv("CODEX_HOME", "");

  await expect(readCodexAuthCredentials()).rejects.toMatchObject({
    code: "auth_required",
    detailCode: "codex_auth_missing",
  });

  const codexHome = path.join(homeDir, ".codex");
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(codexHome, "auth.json"), "{not json");
  await expect(readCodexAuthCredentials()).rejects.toMatchObject({
    code: "auth_required",
    detailCode: "codex_auth_invalid",
  });
});

it("reads ChatGPT credentials with the account id from the access token claims", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-codex-home-"));
  tempDirs.push(homeDir);
  vi.stubEnv("HOME", homeDir);
  vi.stubEnv("CODEX_HOME", "");
  const base64UrlJson = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = `${base64UrlJson({ alg: "none" })}.${base64UrlJson({
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: "codex@example.com",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "account-123",
      chatgpt_account_is_fedramp: true,
    },
  })}.sig`;
  const codexHome = path.join(homeDir, ".codex");
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(
    path.join(codexHome, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: accessToken, refresh_token: "refresh" },
    }),
  );

  await expect(readCodexAuthCredentials()).resolves.toEqual({
    type: "chatgpt",
    accessToken,
    accountId: "account-123",
    accountEmail: "codex@example.com",
    expired: false,
    isFedrampAccount: true,
  });
});

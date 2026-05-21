import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { DESKTOP_AUTO_UPDATE_FEED_CONFIG } from "../src/desktop-update-provider.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const desktopPackageRoot = resolve(testDirectory, "..");

const macConfigSchema = z
  .object({
    entitlements: z.string().min(1),
    entitlementsInherit: z.string().min(1),
    gatekeeperAssess: z.literal(false),
    hardenedRuntime: z.literal(true),
    identity: z.string().nullable().optional(),
    notarize: z.boolean(),
  })
  .passthrough();

const electronBuilderConfigSchema = z
  .object({
    dmg: z
      .object({
        sign: z.boolean(),
      })
      .passthrough(),
    mac: macConfigSchema,
    publish: z.tuple([
      z
        .object({
          channel: z.literal("latest"),
          provider: z.literal("generic"),
          url: z.string().min(1),
        })
        .passthrough(),
    ]),
  })
  .passthrough();

const signingEnvironmentKeys = [
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_ID",
  "APPLE_TEAM_ID",
  "CSC_IDENTITY_AUTO_DISCOVERY",
  "CSC_KEY_PASSWORD",
  "CSC_LINK",
  "CSC_NAME",
];

type ElectronBuilderConfig = z.infer<typeof electronBuilderConfigSchema>;
type EnvironmentOverrides = Record<string, string | undefined>;
type ScriptRunResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
};
type ReadResolvedConfigResult = {
  config: ElectronBuilderConfig;
};
type CreateScriptEnvironment = (
  overrides: EnvironmentOverrides,
) => NodeJS.ProcessEnv;
type RunConfigScript = (
  overrides: EnvironmentOverrides,
) => Promise<ScriptRunResult>;
type ReadResolvedConfig = (
  overrides: EnvironmentOverrides,
) => Promise<ReadResolvedConfigResult>;

const createScriptEnvironment: CreateScriptEnvironment = (overrides) => {
  const env = { ...process.env };

  for (const key of signingEnvironmentKeys) {
    delete env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
};

const runConfigScript: RunConfigScript = async (overrides) => {
  const child = spawn(
    process.execPath,
    ["scripts/run-electron-builder.mjs", "--print-config"],
    {
      cwd: desktopPackageRoot,
      env: createScriptEnvironment(overrides),
    },
  );
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(String(chunk));
  });
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  const exitCode = await new Promise<number | null>((resolveExitCode) => {
    child.on("close", resolveExitCode);
  });

  return {
    exitCode,
    stderr: stderrChunks.join(""),
    stdout: stdoutChunks.join(""),
  };
};

const readResolvedConfig: ReadResolvedConfig = async (overrides) => {
  const result = await runConfigScript(overrides);

  expect(result.exitCode).toBe(0);
  return {
    config: electronBuilderConfigSchema.parse(JSON.parse(result.stdout)),
  };
};

describe("electron-builder signing config", () => {
  it("points mac signing entitlements at checked-in plist files", async () => {
    const configText = await readFile(
      resolve(desktopPackageRoot, "electron-builder.config.json"),
      "utf8",
    );
    const config = electronBuilderConfigSchema.parse(JSON.parse(configText));

    expect(config.mac.entitlements).toBe("build/entitlements.mac.plist");
    expect(config.mac.entitlementsInherit).toBe(
      "build/entitlements.mac.inherit.plist",
    );

    await expect(
      access(resolve(desktopPackageRoot, config.mac.entitlements)),
    ).resolves.toBeUndefined();
    await expect(
      access(resolve(desktopPackageRoot, config.mac.entitlementsInherit)),
    ).resolves.toBeUndefined();
  });

  it("keeps the updater provider pointed at desktop-latest release assets", async () => {
    const configText = await readFile(
      resolve(desktopPackageRoot, "electron-builder.config.json"),
      "utf8",
    );
    const config = electronBuilderConfigSchema.parse(JSON.parse(configText));

    expect(config.publish[0]).toMatchObject(DESKTOP_AUTO_UPDATE_FEED_CONFIG);
  });

  it("keeps local builds unsigned when signing secrets are absent", async () => {
    const { config } = await readResolvedConfig({});

    expect(config.mac.identity).toBeNull();
    expect(config.mac.notarize).toBe(false);
    expect(config.dmg.sign).toBe(false);
  });

  it("rejects partial signing secret sets", async () => {
    const partialAppleCredentials = await runConfigScript({
      APPLE_ID: "sawyer@example.com",
      CSC_KEY_PASSWORD: "p12-password",
      CSC_LINK: "base64-p12",
    });

    expect(partialAppleCredentials.exitCode).toBe(1);
    expect(partialAppleCredentials.stderr).toContain(
      "Incomplete macOS signing/notarization environment.",
    );
    expect(partialAppleCredentials.stderr).toContain(
      "Present: CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID.",
    );
    expect(partialAppleCredentials.stderr).toContain(
      "Missing: APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.",
    );
  });

  it("enables app signing and notarization when signing and Apple credentials are complete", async () => {
    const completeAppleCredentials = await readResolvedConfig({
      APPLE_APP_SPECIFIC_PASSWORD: "app-password",
      APPLE_ID: "sawyer@example.com",
      APPLE_TEAM_ID: "TEAMID1234",
      CSC_KEY_PASSWORD: "p12-password",
      CSC_LINK: "base64-p12",
      CSC_NAME: "Sawyer Hood (TEAMID1234)",
    });

    expect(completeAppleCredentials.config.mac.identity).toBe(
      "Sawyer Hood (TEAMID1234)",
    );
    expect(completeAppleCredentials.config.mac.notarize).toBe(true);
    expect(completeAppleCredentials.config.dmg.sign).toBe(false);
  });
});

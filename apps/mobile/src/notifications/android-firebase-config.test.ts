import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import appConfig from "../../app.config.js";
import { expo } from "../../app.json";

const directories: string[] = [];

function firebaseFile(packageName: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), "bb-firebase-config-"));
  directories.push(directory);
  const file = path.join(directory, "google-services.json");
  writeFileSync(
    file,
    JSON.stringify({
      client: [
        {
          client_info: {
            android_client_info: { package_name: packageName },
          },
        },
      ],
    }),
  );
  return file;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("Android Firebase build configuration", () => {
  it("uses a developer's Expo project for push registration when configured", () => {
    vi.stubEnv("BB_MOBILE_VARIANT", "dev");
    vi.stubEnv("GOOGLE_SERVICES_JSON", firebaseFile("app.getbb.mobile.dev"));
    vi.stubEnv(
      "BB_MOBILE_EXPO_PROJECT_ID",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(appConfig({ config: expo }).extra.eas.projectId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("rejects an invalid Expo project override before building", () => {
    vi.stubEnv("BB_MOBILE_EXPO_PROJECT_ID", "not-a-project-id");
    expect(() => appConfig({ config: expo })).toThrow(
      "BB_MOBILE_EXPO_PROJECT_ID",
    );
  });
  it.each([
    ["dev", "app.getbb.mobile.dev"],
    ["production", "app.getbb.mobile"],
  ])(
    "includes matching Firebase configuration in the %s build",
    (variant, packageName) => {
      const file = firebaseFile(packageName);
      vi.stubEnv("BB_MOBILE_VARIANT", variant);
      vi.stubEnv("GOOGLE_SERVICES_JSON", file);
      const config = appConfig({ config: expo });
      expect(config.android.googleServicesFile).toBe(file);
      expect(config.android.package).toBe(packageName);
      if (variant === "dev") expect(config.android.intentFilters).toEqual([]);
    },
  );

  it("rejects a production-only Firebase client for the dev package", () => {
    vi.stubEnv("BB_MOBILE_VARIANT", "dev");
    vi.stubEnv("GOOGLE_SERVICES_JSON", firebaseFile("app.getbb.mobile"));
    expect(() => appConfig({ config: expo })).toThrow("app.getbb.mobile.dev");
  });

  it("fails before building when a supplied dev configuration file is missing", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "bb-firebase-config-"));
    directories.push(directory);
    vi.stubEnv("BB_MOBILE_VARIANT", "dev");
    vi.stubEnv("GOOGLE_SERVICES_JSON", path.join(directory, "missing.json"));
    expect(() => appConfig({ config: expo })).toThrow(
      "existing Firebase configuration file",
    );
  });
});

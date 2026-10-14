import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BbAppManagedConfig } from "../src/bb-app-managed-config.js";
import { loadCliConfig } from "../src/cli.js";

let homeDir: string;
let dataDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "bb-cli-config-"));
  dataDir = join(homeDir, ".bb");
  mkdirSync(dataDir);
});

afterEach(() => rmSync(homeDir, { recursive: true, force: true }));

function saveConnection(config: BbAppManagedConfig): void {
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(config));
}

const savedConnection = {
  serverUrl: "https://saved.example.test",
  serverHeaders: { "x-bb-connect-machine": "test-saved-credential" },
};

describe("CLI saved connection", () => {
  it("loads the enrolled connection in an ordinary terminal without connection env vars", () => {
    saveConnection(savedConnection);
    const config = loadCliConfig({ env: {}, homeDir });
    expect(config.BB_SERVER_URL).toBe(savedConnection.serverUrl);
    expect(config.BB_SERVER_HEADERS).toEqual(savedConnection.serverHeaders);
  });

  it("reads only the selected data directory", () => {
    saveConnection(savedConnection);
    const selectedDir = join(homeDir, "selected");
    mkdirSync(selectedDir);
    writeFileSync(
      join(selectedDir, "config.json"),
      JSON.stringify({ serverUrl: "https://selected.example.test" }),
    );
    const config = loadCliConfig({
      env: { BB_DATA_DIR: "~/selected" },
      homeDir,
    });
    expect(config.BB_SERVER_URL).toBe("https://selected.example.test");
    expect(config.BB_SERVER_HEADERS).toBeUndefined();
  });

  it.each([
    "http://127.0.0.1:59089",
    "https://other.example.test",
    "https://saved.example.test/other",
  ])(
    "does not copy saved credentials to an explicit override %s",
    (serverUrl) => {
      saveConnection(savedConnection);
      const config = loadCliConfig({
        env: { BB_SERVER_URL: serverUrl },
        homeDir,
      });
      expect(config.BB_SERVER_URL).toBe(serverUrl);
      expect(config.BB_SERVER_HEADERS).toBeUndefined();
    },
  );

  it("retains saved credentials for an explicit override naming the saved server", () => {
    saveConnection(savedConnection);
    const config = loadCliConfig({
      env: { BB_SERVER_URL: `${savedConnection.serverUrl}/` },
      homeDir,
    });
    expect(config.BB_SERVER_HEADERS).toEqual(savedConnection.serverHeaders);
  });

  it("accepts explicitly supplied headers for the explicitly selected server", () => {
    saveConnection(savedConnection);
    const headers = { "x-bb-connect-machine": "test-explicit-credential" };
    const config = loadCliConfig({
      env: {
        BB_SERVER_URL: "https://explicit.example.test",
        BB_SERVER_HEADERS: JSON.stringify(headers),
      },
      homeDir,
    });
    expect(config.BB_SERVER_HEADERS).toEqual(headers);
  });

  it.each([undefined, "  "])(
    "does not bind inherited headers without an explicit server URL (%s)",
    (serverUrl) => {
      saveConnection(savedConnection);
      const config = loadCliConfig({
        env: {
          BB_SERVER_URL: serverUrl,
          BB_SERVER_HEADERS: JSON.stringify({
            "x-bb-connect-machine": "stale-test-credential",
          }),
        },
        homeDir,
      });
      expect(config.BB_SERVER_URL).toBe(savedConnection.serverUrl);
      expect(config.BB_SERVER_HEADERS).toEqual(savedConnection.serverHeaders);
    },
  );

  it("supports the machineCredential field used by existing enrolled machines", () => {
    saveConnection({
      serverUrl: savedConnection.serverUrl,
      machineCredential: "test-machine-credential",
    });
    expect(loadCliConfig({ env: {}, homeDir }).BB_SERVER_HEADERS).toEqual({
      "x-bb-connect-machine": "test-machine-credential",
    });
  });

  it("uses the local default without saved configuration", () => {
    expect(loadCliConfig({ env: {}, homeDir })).toEqual({
      BB_HOST_DAEMON_PORT: 38887,
      BB_SERVER_URL: "http://127.0.0.1:38886",
    });
  });

  it.each([
    '{"serverHeaders":{"x-bb-connect-machine":"secret-test-sentinel"',
    JSON.stringify({
      serverHeaders: { "x-bb-connect-machine": ["secret-test-sentinel"] },
    }),
  ])(
    "rejects malformed configuration without including its contents",
    (content) => {
      writeFileSync(join(dataDir, "config.json"), content);
      expect(() => loadCliConfig({ env: {}, homeDir })).toThrow(
        "Invalid bb CLI configuration",
      );
    },
  );
});

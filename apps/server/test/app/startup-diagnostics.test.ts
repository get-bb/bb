import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerConfig } from "@bb/config/server";
import { describe, expect, it } from "vitest";
import { startHttpListener } from "../../src/start-server.js";

const testDir = dirname(fileURLToPath(import.meta.url));

async function readServerEntrypoint(): Promise<string> {
  return readFile(resolve(testDir, "../../src/index.ts"), "utf8");
}

async function readServerPackageJson(): Promise<string> {
  return readFile(resolve(testDir, "../../package.json"), "utf8");
}

describe("server startup diagnostics", () => {
  it("installs safe diagnostics before loading the startup module", async () => {
    const source = await readServerEntrypoint();
    const installCallIndex = source.indexOf("installSafeProcessDiagnostics({");
    const startupImportIndex = source.indexOf('import("./start-server.js")');

    expect(installCallIndex).toBeGreaterThanOrEqual(0);
    expect(startupImportIndex).toBeGreaterThan(installCallIndex);
    expect(source).not.toContain('from "./db.js"');
    expect(source).not.toContain('from "./server.js"');
    expect(source).not.toContain("process.report");
  });

  it("keeps the startup bundle external to the production bootstrap", async () => {
    const packageJson = await readServerPackageJson();

    expect(packageJson).toContain("--external ./start-server.js");
    expect(packageJson).toContain("src/start-server.ts dist/start-server.js");
  });

  it.each([
    {
      bindHost: undefined,
      expectedAddress: "127.0.0.1",
      name: "binds the default server listener to IPv4 loopback",
    },
    {
      bindHost: "0.0.0.0",
      expectedAddress: "0.0.0.0",
      name: "binds the explicit wildcard listener to IPv4 only",
    },
  ])("$name", async ({ bindHost, expectedAddress }) => {
    const serverConfig = loadServerConfig({
      env: {
        BB_DATA_DIR: "/tmp/bb-server-listener-test",
        BB_HOST_DAEMON_PORT: "49162",
        ...(bindHost === undefined ? {} : { BB_SERVER_BIND_HOST: bindHost }),
        BB_SERVER_PORT: "49161",
        NODE_ENV: "development",
      },
    });
    const server = startHttpListener({
      fetch: () => new Response("ok"),
      serverConfig: { ...serverConfig, BB_SERVER_PORT: 0 },
    });

    try {
      if (!server.listening) {
        await once(server, "listening");
      }
      expect(server.address()).toMatchObject({
        address: expectedAddress,
        family: "IPv4",
      });
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    }
  });
});

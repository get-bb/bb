import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HOST_DAEMON_SYSTEMD_SERVICE_DIRECTIVES } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  createFixture,
  registerServerMoveFixtureCleanup,
  writeSystemdUnit,
} from "./test-fixture.js";

registerServerMoveFixtureCleanup();

const EXEC_START =
  '"/usr/bin/node" "/opt/npm/bin/bb-app" host-daemon --auto-update --host-daemon-port "38887" --server-url "http://old-server:38886"';

describe("ServerMoveService.updateServiceDefinition", () => {
  it("adds the installer's OOM settings to a unit written before them and reloads systemd without a restart", async () => {
    const fixture = await createFixture({ env: {} });
    const unitPath = await writeSystemdUnit({
      homeDir: fixture.homeDir,
      dataDir: fixture.dataDir,
      execStart: EXEC_START,
    });
    const modeBefore = (await stat(unitPath)).mode & 0o777;

    await fixture.service.updateServiceDefinition();
    await fixture.service.updateServiceDefinition();

    const unit = await readFile(unitPath, "utf8");
    for (const directive of HOST_DAEMON_SYSTEMD_SERVICE_DIRECTIVES) {
      expect(unit.split("\n")).toContain(directive);
    }
    expect(unit).toContain(`ExecStart=${EXEC_START}`);
    expect((await stat(unitPath)).mode & 0o777).toBe(modeBefore);
    expect(fixture.commands).toEqual([
      ["systemctl", "--user", "daemon-reload"],
    ]);
    expect(fixture.shutdownRequests).toEqual([]);
  });

  it("keeps the added settings and reports the failure when systemctl daemon-reload fails", async () => {
    const fixture = await createFixture({ env: {} });
    const unitPath = await writeSystemdUnit({
      homeDir: fixture.homeDir,
      dataDir: fixture.dataDir,
      execStart: EXEC_START,
    });
    const service = fixture.createService({
      runCommand: async () => {
        throw new Error("Failed to connect to bus");
      },
    });

    await service.updateServiceDefinition();

    expect((await readFile(unitPath, "utf8")).split("\n")).toContain(
      "OOMPolicy=continue",
    );
    expect(fixture.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: unitPath }),
      expect.stringContaining("systemctl daemon-reload failed"),
    );
  });

  it("finishes the update before a server move rewrites the same unit", async () => {
    const fixture = await createFixture({
      env: {},
      serverUrl: "http://old-server:38886",
    });
    await writeFile(
      join(fixture.dataDir, "config.json"),
      JSON.stringify({ serverUrl: "http://old-server:38886" }),
    );
    const unitPath = await writeSystemdUnit({
      homeDir: fixture.homeDir,
      dataDir: fixture.dataDir,
      execStart: EXEC_START,
    });

    await Promise.all([
      fixture.service.updateServiceDefinition(),
      fixture.service.handleServerMoved({
        source: "message",
        serverUrl: "https://studio.example.test/",
        headers: { "x-bb-connect-machine": "bbcm_new" },
      }),
    ]);

    const unit = await readFile(unitPath, "utf8");
    expect(unit).toContain('"--server-url" "https://studio.example.test"');
    expect(unit.split("\n")).toContain("OOMPolicy=continue");
    expect(fixture.commands).toEqual([
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "daemon-reload"],
      [
        "systemctl",
        "--user",
        "restart",
        "--no-block",
        "bb-host-daemon-old-server-studio.service",
      ],
    ]);
  });

  it("keeps an OOM policy that the unit already sets", async () => {
    const fixture = await createFixture({ env: {} });
    const unitPath = await writeSystemdUnit({
      homeDir: fixture.homeDir,
      dataDir: fixture.dataDir,
      execStart: EXEC_START,
    });
    const content = (await readFile(unitPath, "utf8")).replace(
      "Restart=always",
      "Restart=always\nOOMPolicy=stop\nManagedOOMPreference=none",
    );
    await writeFile(unitPath, content);

    await fixture.service.updateServiceDefinition();

    expect(await readFile(unitPath, "utf8")).toBe(content);
    expect(fixture.commands).toEqual([]);
  });

  it("leaves the unit alone when bb does not manage the service", async () => {
    const fixture = await createFixture({
      env: { BB_SERVER_MOVE_SERVICE_MANAGER: "none" },
    });
    const unitPath = await writeSystemdUnit({
      homeDir: fixture.homeDir,
      dataDir: fixture.dataDir,
      execStart: EXEC_START,
    });
    const content = await readFile(unitPath, "utf8");

    await fixture.service.updateServiceDefinition();

    expect(await readFile(unitPath, "utf8")).toBe(content);
    expect(fixture.commands).toEqual([]);
  });
});

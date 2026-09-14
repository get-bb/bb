import {
  createConnection,
  migrate,
  noopNotifier,
  setAppSettings,
  updateHost,
  upsertHost,
} from "@bb/db";
import { defaultAppSettings } from "@bb/domain";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { NotificationHub } from "../../ws/hub.js";
import { replaceMachineEnvironment } from "../machines/environment-settings.js";
import { HostEnvironmentSync } from "./host-environment-sync.js";

it("synchronizes configured variables on connection, changes and reconnect while excluding the local host", async () => {
  const db = createConnection(":memory:");
  const dataDir = await mkdtemp(join(tmpdir(), "bb-machine-env-sync-"));
  const hub = new NotificationHub();
  try {
    migrate(db);
    setAppSettings(db, {
      ...defaultAppSettings,
      machineGitCredentialsEnabled: false,
    });
    for (const id of ["remote", "local"]) {
      upsertHost(db, noopNotifier, { id, name: id });
      updateHost(db, noopNotifier, id, { machineProviderId: "manual" });
    }
    await writeFile(join(dataDir, "host-id"), "local");
    await replaceMachineEnvironment(db, dataDir, {
      variables: [{ name: "MACHINE_VALUE", value: "first", note: null }],
    });
    const sync = new HostEnvironmentSync({
      db,
      config: { dataDir },
      hub,
      logger: { warn: vi.fn() },
    });
    expect((await sync.snapshot("remote")).entries).toContainEqual(
      expect.objectContaining({ name: "MACHINE_VALUE", value: "first" }),
    );
    expect((await sync.snapshot("local")).entries).toEqual([]);
    const sent: string[] = [];
    hub.registerDaemon("session-1", "remote", {
      send: (data) => {
        sent.push(data);
      },
      close: () => {},
    });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(JSON.parse(sent[0]!)).toMatchObject({
      type: "machine-environment.replace",
      environment: {
        entries: [
          expect.objectContaining({ name: "MACHINE_VALUE", value: "first" }),
        ],
      },
    });
    await replaceMachineEnvironment(db, dataDir, {
      variables: [{ name: "MACHINE_VALUE", value: "second", note: null }],
    });
    hub.notifySystem(["config-changed"]);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(JSON.parse(sent[1]!)).toMatchObject({
      environment: { entries: [expect.objectContaining({ value: "second" })] },
    });
    await replaceMachineEnvironment(db, dataDir, { variables: [] });
    hub.notifySystem(["config-changed"]);
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(JSON.parse(sent[2]!)).toMatchObject({
      environment: { entries: [] },
    });
    hub.unregisterDaemon("session-1");
    hub.registerDaemon("session-2", "remote", {
      send: (data) => {
        sent.push(data);
      },
      close: () => {},
    });
    await vi.waitFor(() => expect(sent).toHaveLength(4));
    expect(JSON.parse(sent[3]!)).toMatchObject({
      environment: { entries: [] },
    });
  } finally {
    hub.unregisterDaemon("session-1");
    hub.unregisterDaemon("session-2");
    db.$client.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

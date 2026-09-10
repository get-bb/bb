import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createEnvironment } from "../../src/data/environments.js";
import { updateHost, upsertHost } from "../../src/data/hosts.js";
import {
  machineHasLiveThreadLaunch,
  machineHasProvisioningEnvironment,
} from "../../src/data/machines.js";
import { createProject } from "../../src/data/projects.js";
import { archiveThread, createThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { environments } from "../../src/schema.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  return { db, host, project };
}

describe("machine provisioning state", () => {
  it("finds a live thread from the machine launch key until it is archived", () => {
    const { db, host, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "starting",
    });
    updateHost(db, noopNotifier, host.id, { launchKey: thread.id });

    expect(machineHasLiveThreadLaunch(db, host.id)).toBe(true);
    archiveThread(db, noopNotifier, thread.id);
    expect(machineHasLiveThreadLaunch(db, host.id)).toBe(false);
  });

  it("finds a provisioning environment on the host until it is ready", () => {
    const { db, host, project } = setup();
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/environment",
      providerOwnsPath: false,
      status: "provisioning",
      environmentProvider: null,
    });

    expect(machineHasProvisioningEnvironment(db, host.id)).toBe(true);
    db.update(environments)
      .set({ status: "ready" })
      .where(eq(environments.id, environment.id))
      .run();
    expect(machineHasProvisioningEnvironment(db, host.id)).toBe(false);
  });
});

import { defaultAppSettings } from "@bb/domain";
import {
  createConnection,
  migrate,
  upsertHost,
  noopNotifier,
  getHost,
  setAppSettings,
} from "@bb/db";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { resolveHostEnvironment } from "./host-environment.js";
import { updateMachineEnvironment } from "../machines/environment-settings.js";

it("gives backfilled manual machines user and gh environment without enrollment while excluding the local daemon", async () => {
  const db = createConnection(":memory:");
  const dataDir = await mkdtemp(join(tmpdir(), "bb-backfilled-env-"));
  try {
    migrate(db);
    upsertHost(db, noopNotifier, { id: "legacy-remote", name: "Remote" });
    upsertHost(db, noopNotifier, { id: "local-daemon", name: "Local" });
    const sql = (
      await readFile(
        new URL(
          "../../../../../packages/db/drizzle/0117_machine_providers.sql",
          import.meta.url,
        ),
        "utf8",
      )
    )
      .split("--> statement-breakpoint")
      .find((statement) => statement.includes("UPDATE hosts"));
    if (sql === undefined) throw new Error("Missing manual machine backfill");
    db.$client.exec(sql);
    migrate(db);
    await writeFile(join(dataDir, "host-id"), "local-daemon");
    expect(getHost(db, "legacy-remote")?.machineProviderId).toBe("manual");
    await updateMachineEnvironment(db, dataDir, "MACHINE_VALUE", {
      name: "MACHINE_VALUE",
      value: "configured",
      note: null,
    });
    const bin = join(dataDir, "bin");
    await mkdir(bin);
    await writeFile(
      join(bin, "gh"),
      `#!/bin/sh
if [ "$1" = auth ]; then printf 'test-gh-secret\\n'; else printf '{"login":"octocat","id":123,"email":null}\\n'; fi
`,
      { mode: 0o700 },
    );
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    const deps = { db, config: { dataDir } };
    expect(
      await resolveHostEnvironment(deps, {
        hostId: "legacy-remote",
        projectId: null,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "MACHINE_VALUE", value: "configured" }),
        expect.objectContaining({
          name: "GH_TOKEN",
          value: "test-gh-secret",
        }),
      ]),
    );
    expect(
      await resolveHostEnvironment(deps, {
        hostId: "local-daemon",
        projectId: null,
      }),
    ).toEqual([]);
    setAppSettings(db, {
      ...defaultAppSettings,
      machineGitCredentialsEnabled: false,
    });
    const disabled = await resolveHostEnvironment(deps, {
      hostId: "legacy-remote",
      projectId: null,
    });
    expect(disabled.some((row) => row.name === "GH_TOKEN")).toBe(false);
    expect(disabled.some((row) => row.name === "MACHINE_VALUE")).toBe(true);
    await updateMachineEnvironment(db, dataDir, "GH_TOKEN", {
      name: "GH_TOKEN",
      value: "custom-token",
      note: null,
    });
    const overridden = await resolveHostEnvironment(deps, {
      hostId: "legacy-remote",
      projectId: null,
    });
    expect(overridden.find((row) => row.name === "GH_TOKEN")?.value).toBe(
      "custom-token",
    );
  } finally {
    vi.unstubAllEnvs();
    db.$client.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

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
import { replaceMachineEnvironment } from "../machines/environment-settings.js";

// bb-fork(windows): the fake `gh` is a `#!/bin/sh` script.
it.skipIf(process.platform === "win32")(
  "gives every host user environment while forwarding automatic gh credentials only to non-primary hosts",
  async () => {
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
      await replaceMachineEnvironment(db, dataDir, {
        variables: [{ name: "MACHINE_VALUE", value: "configured", note: null }],
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
          expect.objectContaining({
            name: "MACHINE_VALUE",
            value: "configured",
          }),
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
      ).toEqual([
        expect.objectContaining({
          name: "MACHINE_VALUE",
          value: "configured",
        }),
      ]);
      upsertHost(db, noopNotifier, {
        id: "providerless",
        name: "Providerless",
      });
      expect(
        await resolveHostEnvironment(deps, {
          hostId: "providerless",
          projectId: null,
        }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "MACHINE_VALUE",
            value: "configured",
          }),
          expect.objectContaining({
            name: "GH_TOKEN",
            value: "test-gh-secret",
          }),
        ]),
      );
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
      await replaceMachineEnvironment(db, dataDir, {
        variables: [
          { name: "MACHINE_VALUE", value: null, note: null },
          { name: "GH_TOKEN", value: "custom-token", note: null },
        ],
      });
      const overridden = await resolveHostEnvironment(deps, {
        hostId: "legacy-remote",
        projectId: null,
      });
      expect(overridden.find((row) => row.name === "GH_TOKEN")?.value).toBe(
        "custom-token",
      );
      const localOverride = await resolveHostEnvironment(deps, {
        hostId: "local-daemon",
        projectId: null,
      });
      expect(localOverride.find((row) => row.name === "GH_TOKEN")?.value).toBe(
        "custom-token",
      );
      expect(localOverride).toContainEqual(
        expect.objectContaining({ name: "GIT_CONFIG_COUNT" }),
      );
    } finally {
      vi.unstubAllEnvs();
      db.$client.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);

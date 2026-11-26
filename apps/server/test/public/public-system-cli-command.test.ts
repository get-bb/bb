import { describe, expect, it } from "vitest";
import type { SystemCliCommandStatus } from "@bb/server-contract";
import type { CliCommandService } from "../../src/services/system/cli-command.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const API = "/api/v1/system/cli-command";
function machineHeaders(harness: TestAppHarness): Record<string, string> {
  return {
    "x-bb-gate-auth": "machine",
    "x-bb-tunnel-marker": harness.deps.access.tunnelMarker,
  };
}

function recordingService(): {
  calls: string[];
  service: CliCommandService;
} {
  const calls: string[] = [];
  const status = (installed: boolean): SystemCliCommandStatus => ({
    installedPath: installed ? "/home/me/.local/bin/bb" : null,
    onPath: installed,
    shadowedBy: null,
    supported: true,
  });
  return {
    calls,
    service: {
      getStatus: () => {
        calls.push("status");
        return Promise.resolve(status(false));
      },
      install: () => {
        calls.push("install");
        return Promise.resolve(status(true));
      },
      remove: () => {
        calls.push("remove");
        return Promise.resolve(status(false));
      },
    },
  };
}

describe("/api/v1/system/cli-command", () => {
  it("reports the bb command as unavailable when bb runs without the launcher", () =>
    withTestHarness(async (harness) => {
      const response = await harness.app.request(API);

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        installedPath: null,
        onPath: false,
        shadowedBy: null,
        supported: false,
      });

      const install = await harness.app.request(`${API}/install`, {
        method: "POST",
      });
      expect(install.status).toBe(409);
      expect(await readJson(install)).toMatchObject({
        code: "cli_command_unsupported",
      });
    }));

  it("installs and removes through the service and returns the new status", () => {
    const { calls, service } = recordingService();
    return withTestHarness({ cliCommandService: service }, async (harness) => {
      const installed = await harness.app.request(`${API}/install`, {
        method: "POST",
      });
      expect(installed.status).toBe(200);
      expect(await readJson(installed)).toMatchObject({
        installedPath: "/home/me/.local/bin/bb",
        onPath: true,
      });

      const removed = await harness.app.request(`${API}/remove`, {
        method: "POST",
      });
      expect(await readJson(removed)).toMatchObject({ installedPath: null });
      expect(calls).toEqual(["install", "remove"]);
    });
  });

  it("does not let machine credentials change the server computer's PATH", () => {
    const { calls, service } = recordingService();
    return withTestHarness({ cliCommandService: service }, async (harness) => {
      for (const action of ["install", "remove"]) {
        const response = await harness.app.request(`${API}/${action}`, {
          headers: machineHeaders(harness),
          method: "POST",
        });
        expect(response.status).toBe(403);
      }
      expect(calls).toEqual([]);
    });
  });
});

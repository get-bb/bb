import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { permissionModeValues } from "@bb/domain";

const qaRoot = path.resolve(import.meta.dirname, "../../../qa");
const publicPermissionModes = new Set<string>(permissionModeValues);

async function readRunbook(name: string): Promise<string> {
  return fs.readFile(path.join(qaRoot, name), "utf8");
}

describe("QA runbook contracts", () => {
  it.each(["manual-runbook.md", "provider-permission-mode-runbook.md"])(
    "%s uses only public CLI permission modes",
    async (name) => {
      const runbook = await readRunbook(name);
      const modes = [...runbook.matchAll(/--permission-mode\s+(\S+)/g)].map(
        (match) => match[1],
      );

      expect(modes.length).toBeGreaterThan(0);
      expect(modes.filter((mode) => !publicPermissionModes.has(mode))).toEqual(
        [],
      );
    },
  );

  it("uses a deterministic outside-workspace target for interaction probes", async () => {
    const runbook = await readRunbook("manual-runbook.md");

    expect(runbook).toContain(
      'mktemp -d "${HOME:?}/.bb-approval-smoke.XXXXXX"',
    );
    expect(runbook).toContain('mktemp -d "${HOME:?}/.bb-denial-smoke.XXXXXX"');
    expect(runbook).not.toMatch(/mktemp -d \/tmp\/bb-(?:approval|denial)/);
  });

  it("documents provisioning retry only after a completed failure", async () => {
    const runbook = await readRunbook("manual-runbook.md");

    expect(runbook).toContain("Provisioning failure and next-message retry");
    expect(runbook).toContain(
      'bb thread wait "$PROVISION_RETRY_THREAD_ID" --status error',
    );
    expect(runbook).toContain(
      'bb thread tell "$PROVISION_RETRY_THREAD_ID" "Say exactly: provisioning retry ok" --mode auto',
    );
    expect(runbook).not.toContain(
      "Server restart during environment provisioning",
    );
    expect(runbook).not.toMatch(/active[_ -]provisioning[_ -]id/i);
  });

  it("recovers when daemon disconnect settlement races an active-state snapshot", async () => {
    const runbook = await readRunbook("manual-runbook.md");

    expect(runbook).toContain(
      'bb thread wait "$SMOKE_THREAD_ID" --status idle --timeout 180 || true',
    );
    expect(runbook).toContain(
      'if [ "$THREAD_STATE" != "idle" ]; then\n  bb thread tell "$SMOKE_THREAD_ID" "Say exactly: recovery ok" --mode auto',
    );
  });
});

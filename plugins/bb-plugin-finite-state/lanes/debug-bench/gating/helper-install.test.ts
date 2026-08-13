import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openStore } from "../../../lib/store/index.js";
import type { FamilyDescriptor } from "../registry/families.js";
import { helperInstallRecord } from "../registry/helpers.js";
import {
  confirmHelperInstall,
  helperInstallGateAudit,
  proposeHelperInstall,
} from "./helper-install.js";
import type { GatingDeps } from "./mode.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const family: FamilyDescriptor = {
  id: "fixture-probe",
  kind: "probe",
  label: "Fixture probe",
  detectionStrategy: "fixture",
  helper: {
    id: "fixture-helper",
    displayName: "Fixture helper",
    source: "https://example.test/helper",
    why: "Detect fixture probes",
    check: ["fixture-helper", "--version"],
    install: ["python3", "-m", "pip", "install", "fixture-helper"],
  },
  transports: ["local-usb"],
};

function fixture() {
  const host = createFakePluginHost({ pluginId: `fs-helper-gate-${crypto.randomUUID()}` });
  hosts.push(host);
  const deps: GatingDeps = {
    db: openStore(host.bb).db,
    sessionId: "thread-a",
    now: () => new Date("2026-08-13T12:00:00.000Z"),
  };
  return { host, deps };
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});
describe("helper installation gate", () => {
  it("never invokes the installer before a submitted human interaction", async () => {
    const fx = fixture();
    const proposal = proposeHelperInstall(fx.deps.db, family, fx.deps.now?.());
    const installer = vi.fn(async () => ({ message: "installed" }));
    const confirmation = confirmHelperInstall({
      bb: fx.host.bb,
      deps: fx.deps,
      threadId: "thread-a",
      proposalToken: proposal.proposalToken,
      installer,
    });
    await vi.waitFor(() => expect(fx.host.harness.pendingInteractions).toHaveLength(1));
    expect(installer).not.toHaveBeenCalled();
    fx.host.harness.cancelInteraction(fx.host.harness.pendingInteractions[0]!.id);

    await expect(confirmation).rejects.toMatchObject({ code: "DESTRUCTIVE_CONFIRMATION_REJECTED" });
    expect(installer).not.toHaveBeenCalled();
    expect(helperInstallRecord(fx.deps.db, proposal.proposalToken)).toMatchObject({ state: "proposed" });
    expect(helperInstallGateAudit(fx.deps, proposal.proposalToken)).toBeNull();
  });

  it("consumes one unified grant, installs, and records server-issued caller origin", async () => {
    const fx = fixture();
    const proposal = proposeHelperInstall(fx.deps.db, family, fx.deps.now?.());
    const installer = vi.fn(async () => ({ message: "installed" }));
    const confirmation = confirmHelperInstall({
      bb: fx.host.bb,
      deps: fx.deps,
      threadId: "thread-a",
      proposalToken: proposal.proposalToken,
      installer,
    });
    await vi.waitFor(() => expect(fx.host.harness.pendingInteractions).toHaveLength(1));
    fx.host.harness.submitInteraction(fx.host.harness.pendingInteractions[0]!.id, { confirmed: true });

    await expect(confirmation).resolves.toMatchObject({
      state: "installed",
      confirmedBy: expect.stringMatching(/^request-input-response:thread-a:/),
    });
    expect(installer).toHaveBeenCalledOnce();
    expect(helperInstallGateAudit(fx.deps, proposal.proposalToken)).toMatchObject({
      callerOrigin: "bb.ui.requestInput",
      confirmedBy: expect.stringMatching(/^request-input-response:thread-a:/),
      outcome: "installed",
      consumedAt: "2026-08-13T12:00:00.000Z",
    });
  });
});

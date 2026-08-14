// @vitest-environment jsdom

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import {
  cleanup,
  configure,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { findingStableKey } from "../../../../lib/sync/registry.js";
import { connectedRemoteStatus } from "../../../../test/app-connections.js";
import { findingsUiRpcContract, registerFindingsRpc } from "../../rpc.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const roots: string[] = [];

class RegisteredSurfaceResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(element: Element): void {
    queueMicrotask(() =>
      this.callback(
        [
          {
            target: element,
            contentRect: new DOMRectReadOnly(0, 0, 1200, 600),
            borderBoxSize: [{ blockSize: 600, inlineSize: 1200 }],
            contentBoxSize: [{ blockSize: 600, inlineSize: 1200 }],
            devicePixelContentBoxSize: [{ blockSize: 600, inlineSize: 1200 }],
          },
        ],
        this,
      ),
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  configure({ asyncUtilTimeout: 10_000 });
  vi.stubGlobal("ResizeObserver", RegisteredSurfaceResizeObserver);
  vi.stubGlobal("crypto", {
    randomUUID: () => "00000000-0000-4000-8000-000000000168",
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  HTMLElement.prototype.scrollIntoView = function scrollIntoView(): void {};
  HTMLElement.prototype.scrollTo = function scrollTo(
    options?: ScrollToOptions | number,
    y?: number,
  ): void {
    this.scrollTop =
      typeof options === "number" ? (y ?? 0) : (options?.top ?? 0);
    this.dispatchEvent(new Event("scroll"));
  };
});

afterEach(async () => {
  cleanup();
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function registeredFixture() {
  const root = await mkdtemp(join(tmpdir(), "fs168-bulk-registered-"));
  roots.push(root);
  const host = createFakePluginHost({
    pluginId: `fs168-bulk-${hosts.length}`,
    sdk: {
      projects: {
        get: ({ projectId }) => ({
          id: projectId,
          sources: [{ hostId: "host-1", path: root, isDefault: true }],
        }),
      },
    },
  });
  hosts.push(host);
  const db = createPluginContext(host.bb).db();
  db.prepare(
    `INSERT INTO pull_generation
    (project_id, project_version_id, generation_id, status, requested_kinds_json, started_at, completed_at, accepted_at, error)
    VALUES ('platform-project-1','version-1','generation-1','accepted','["finding"]',?,?,?,NULL)`,
  ).run(
    "2026-08-13T00:00:00.000Z",
    "2026-08-13T00:00:00.000Z",
    "2026-08-13T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO sync_state
    (project_id, project_version_id, entity_kind, accepted_generation_id, staging_generation_id, base_revision, staging_continuation, staged_pages, staged_rows, last_pull, error)
    VALUES ('platform-project-1','version-1','finding','generation-1',NULL,1,NULL,0,0,?,NULL)`,
  ).run("2026-08-13T00:00:00.000Z");
  const insert = db.prepare(`INSERT INTO findings
    (project_id, project_version_id, generation_id, finding_id, stable_key, cve, component_name, component_version, component_purl, reachability_verdict, reachability_factors, raw, pulled_at)
    VALUES ('platform-project-1','version-1','generation-1',?,?,?,?,?,?,'unreachable',?,'{}',?)`);
  for (const [findingId, cve] of [
    ["exact-row-a", "CVE-2026-0168"],
    ["exact-row-b", "CVE-2026-0169"],
  ] as const) {
    const stableKey = findingStableKey(
      { cve, purl: "pkg:generic/gateway@1", name: "gateway", version: "1" },
      "purl",
    );
    insert.run(
      findingId,
      stableKey,
      cve,
      "gateway",
      "1",
      "pkg:generic/gateway@1",
      '[{"label":"Call graph","value":"no path","source":"analysis"}]',
      "2026-08-13T00:00:00.000Z",
    );
  }
  registerFindingsRpc(host.bb, db);
  return { host, root };
}

describe("bulk triage registered surface", () => {
  it("writes YAML when the registered Findings panel submits the registered bulk RPC", async () => {
    const { host, root } = await registeredFixture();
    const app = await loadPluginApp(() => import("../../../../app.js"));
    const panel = app.navPanels.find(
      (candidate) => candidate.path === "findings",
    );
    if (!panel) throw new Error("registered Findings panel missing");

    const writtenFiles: string[] = [];
    const slot = renderSlot(
      panel,
      { subPath: "" },
      {
        context: { projectId: "workspace-project-1" },
        sidebarThreads: {
          status: "ready",
          projects: [
            { id: "workspace-project-1", name: "Workspace", isPersonal: false },
          ],
        },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          cachedProjectVersions: async (input) =>
            findingsUiRpcContract.cachedProjectVersions.output.parse(
              await host.harness.callRpc("cachedProjectVersions", input),
            ),
          findingsSavedViewsGet: () => ({
            views: [],
            sha256: null,
            recoveredFromCorrupt: false,
          }),
          findingsUiList: async (input) =>
            findingsUiRpcContract.findingsUiList.output.parse(
              await host.harness.callRpc("findingsUiList", input),
            ),
          triageTargetsRead: async (input) =>
            findingsUiRpcContract.triageTargetsRead.output.parse(
              await host.harness.callRpc("triageTargetsRead", input),
            ),
          triageDecisionsWrite: async (input) => {
            const result =
              findingsUiRpcContract.triageDecisionsWrite.output.parse(
                await host.harness.callRpc("triageDecisionsWrite", input),
              );
            const file = result.results.find((item) => item.success)?.file;
            if (file) writtenFiles.push(file);
            return result;
          },
        },
      },
    );

    await waitFor(() =>
      expect(
        slot.container.querySelectorAll("[data-finding-row]"),
      ).toHaveLength(2),
    );
    fireEvent.click(slot.getByRole("button", { name: "Select all 2" }));
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.click(slot.getByRole("button", { name: /eEXPLOITABLE/u }));
    const editor = await slot.findByRole("form", {
      name: /2 local overlay identities/u,
    });
    fireEvent.change(within(editor).getByLabelText("Reason"), {
      target: { value: "Reviewed both exact cached findings" },
    });
    fireEvent.click(within(editor).getByRole("checkbox"));
    expect(
      slot.queryByRole("button", { name: "Confirm local writes" }),
    ).toBeNull();
    fireEvent.click(
      within(editor).getByRole("button", { name: /Write YAML/u }),
    );
    const confirm = await slot.findByRole("button", {
      name: "Confirm local writes",
    });
    expect(document.activeElement).toBe(confirm);
    const activeConfirm = document.activeElement;
    if (!activeConfirm)
      throw new Error("bulk confirmation did not receive focus");
    fireEvent.keyDown(activeConfirm, {
      key: "Enter",
      metaKey: true,
    });

    await waitFor(() => expect(writtenFiles.length).toBeGreaterThan(0));
    const yamls = await Promise.all(
      [...new Set(writtenFiles)].map((file) =>
        readFile(join(root, file), "utf8"),
      ),
    );
    const writtenYaml = yamls.join("\n");
    expect(writtenYaml).toContain("CVE-2026-0168");
    expect(writtenYaml).toContain("CVE-2026-0169");
    expect(writtenYaml.match(/status: EXPLOITABLE/gu)).toHaveLength(2);
    expect(
      await slot.findByText("2 local YAML decisions written; 0 failed."),
    ).toBeTruthy();
  });

  it("commits a single decision with the target-read scope after the live catalog becomes unresolved", async () => {
    const { host, root } = await registeredFixture();
    const app = await loadPluginApp(() => import("../../../../app.js"));
    const panel = app.navPanels.find(
      (candidate) => candidate.path === "findings",
    );
    if (!panel) throw new Error("registered Findings panel missing");

    let catalogReads = 0;
    let announceTargetRead: (() => void) | undefined;
    const targetReadStarted = new Promise<void>((resolve) => {
      announceTargetRead = resolve;
    });
    let releaseTargetRead: (() => void) | undefined;
    const targetReadGate = new Promise<void>((resolve) => {
      releaseTargetRead = resolve;
    });
    const slot = renderSlot(
      panel,
      { subPath: "" },
      {
        context: { projectId: "workspace-project-1" },
        sidebarThreads: {
          status: "ready",
          projects: [
            { id: "workspace-project-1", name: "Workspace", isPersonal: false },
          ],
        },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          cachedProjectVersions: async (input) => {
            catalogReads += 1;
            if (catalogReads > 1) {
              return {
                versions: [],
                selectedPlatformProjectId: null,
                selectedProjectVersionId: null,
              };
            }
            return findingsUiRpcContract.cachedProjectVersions.output.parse(
              await host.harness.callRpc("cachedProjectVersions", input),
            );
          },
          findingsSavedViewsGet: () => ({
            views: [],
            sha256: null,
            recoveredFromCorrupt: false,
          }),
          findingsUiList: async (input) =>
            findingsUiRpcContract.findingsUiList.output.parse(
              await host.harness.callRpc("findingsUiList", input),
            ),
          triageTargetsRead: async (input) => {
            const result = findingsUiRpcContract.triageTargetsRead.output.parse(
              await host.harness.callRpc("triageTargetsRead", input),
            );
            announceTargetRead?.();
            await targetReadGate;
            return result;
          },
          triageDecisionsWrite: async (input) =>
            findingsUiRpcContract.triageDecisionsWrite.output.parse(
              await host.harness.callRpc("triageDecisionsWrite", input),
            ),
          triageDecisionUndo: async (input) =>
            findingsUiRpcContract.triageDecisionUndo.output.parse(
              await host.harness.callRpc("triageDecisionUndo", input),
            ),
        },
      },
    );

    await waitFor(() =>
      expect(
        slot.container.querySelectorAll("[data-finding-row]"),
      ).toHaveLength(2),
    );
    fireEvent.keyDown(window, { key: "e" });
    await targetReadStarted;
    await slot.behavior.emitRealtime("findings:changed", {
      projectVersionId: "different-version",
    });
    await waitFor(() => expect(catalogReads).toBeGreaterThan(1));
    releaseTargetRead?.();

    const editor = await slot.findByRole("form", { name: /Triage/u });
    fireEvent.change(within(editor).getByLabelText("Reason"), {
      target: { value: "Reviewed the exact cached finding" },
    });
    fireEvent.click(within(editor).getByRole("checkbox"));
    const write = within(editor).getByRole("button", { name: /Write YAML/u });
    expect((write as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(write);

    const written = join(root, ".fs/triage/platform-project-1/gateway.yaml");
    await waitFor(async () =>
      expect(await readFile(written, "utf8")).toContain("status: EXPLOITABLE"),
    );
    const rpcWrite = slot.inspection.rpcCalls.find(
      (call) => call.method === "triageDecisionsWrite",
    );
    expect(rpcWrite?.input).toMatchObject({
      workspaceProjectId: "workspace-project-1",
      platformProjectId: "platform-project-1",
      projectVersionId: "version-1",
    });
    expect(
      slot.queryByText(/no resolved project and version scope/u),
    ).toBeNull();

    fireEvent.keyDown(window, { key: "u" });
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "triageDecisionUndo",
        ),
      ).toHaveLength(1),
    );
    const rpcUndo = slot.inspection.rpcCalls.find(
      (call) => call.method === "triageDecisionUndo",
    );
    expect(rpcUndo?.input).toMatchObject({
      workspaceProjectId: "workspace-project-1",
      platformProjectId: "platform-project-1",
      projectVersionId: "version-1",
    });
    await waitFor(async () =>
      expect(await readFile(written, "utf8").catch(() => "")).not.toContain(
        "status: EXPLOITABLE",
      ),
    );
    expect(slot.getByText(/Undid the last local decision/u)).toBeTruthy();
  });
});

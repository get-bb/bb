// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  configure,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { connectedRemoteStatus } from "../../../../test/app-connections.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const freshCache = {
  state: "fresh" as const,
  asOf: "2026-08-13T00:00:00.000Z",
  message: null,
  acceptedGenerationId: "generation-1",
  baseRevision: 1,
};

function finding(index: number) {
  return {
    projectId: "platform-project-1",
    projectVersionId: "version-1",
    kind: "finding",
    key: `finding-${index}`,
    label: `Finding ${index}`,
    fields: {
      stableKey: `stable-${index}`,
      cve: `CVE-2026-${index}`,
      componentName: `component-${index}`,
      componentVersion: "1",
      severity: "high",
      reachabilityVerdict: "unreachable",
      localState: "none",
    },
  };
}

function target(
  findingId: string,
  expectedSha256: string | null = null,
  componentName?: string,
) {
  const index = Number(findingId.split("-").at(-1));
  const name = componentName ?? `component-${index}`;
  return {
    findingId,
    stableKey: `stable-${index}`,
    cve: `CVE-2026-${index}`,
    label: `CVE-2026-${index} · ${name} 1`,
    component: { purl: null, name, group: null, version: "1" },
    evidence: "Call graph: no reachable path",
    reasonSeed: "Call graph: no reachable path",
    expectedSha256,
    file: expectedSha256 ? ".fs/triage/gateway.yaml" : null,
    prior: null,
  };
}

function success(findingId: string, stableKey: string) {
  return {
    success: true as const,
    findingId,
    stableKey,
    file: `.fs/triage/${findingId}.yaml`,
    afterSha256: SHA_B,
    undo: {
      file: `.fs/triage/${findingId}.yaml`,
      beforeSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      afterSha256: SHA_B,
      prior: null,
    },
  };
}

class FlowResizeObserver implements ResizeObserver {
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
  vi.stubGlobal("ResizeObserver", FlowResizeObserver);
  vi.stubGlobal("crypto", {
    randomUUID: () => "00000000-0000-4000-8000-000000000041",
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

afterEach(() => cleanup());

async function renderFlow(
  options: {
    write?: (input: Record<string, unknown>) => unknown;
    undo?: (input: Record<string, unknown>) => unknown;
    read?: (input: Record<string, unknown>) => unknown;
    findings?: ReturnType<typeof finding>[];
    catalogAvailable?: () => boolean;
  } = {},
) {
  const app = await loadPluginApp(() => import("../../../../app.js"));
  const panel = app.navPanels.find(
    (candidate) => candidate.path === "findings",
  );
  if (!panel) throw new Error("Findings panel missing");
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
        cachedProjectVersions: () =>
          options.catalogAvailable?.() === false
            ? {
                versions: [],
                selectedPlatformProjectId: null,
                selectedProjectVersionId: null,
              }
            : {
                versions: [
                  {
                    platformProjectId: "platform-project-1",
                    projectVersionId: "version-1",
                    asOf: freshCache.asOf,
                    state: "fresh",
                  },
                ],
                selectedPlatformProjectId: "platform-project-1",
                selectedProjectVersionId: "version-1",
              },
        findingsSavedViewsGet: () => ({
          views: [],
          sha256: null,
          recoveredFromCorrupt: false,
        }),
        findingsUiList: () => ({
          items: options.findings ?? [finding(0), finding(1), finding(2)],
          total: options.findings?.length ?? 3,
          next: null,
          cache: freshCache,
        }),
        triageTargetsRead: (input) => {
          const record = input as Record<string, unknown>;
          const overridden = options.read?.(record);
          if (overridden) return overridden;
          const selection = record["selection"] as {
            mode?: string;
            findingIds?: string[];
          };
          const ids =
            selection.mode === "predicate"
              ? (options.findings ?? [finding(0), finding(1), finding(2)]).map(
                  (item) => item.key,
                )
              : (selection.findingIds ?? []);
          return {
            items: ids.map((id) => target(id)),
            total: ids.length,
            next: null,
          };
        },
        triageDecisionsWrite: (input) => {
          const record = input as Record<string, unknown>;
          return (
            options.write?.(record) ?? {
              results: (
                record["decisions"] as Array<{
                  findingId: string;
                  stableKey: string;
                }>
              ).map((item) => success(item.findingId, item.stableKey)),
            }
          );
        },
        triageDecisionUndo: (input) =>
          options.undo?.(input as Record<string, unknown>) ?? {
            file: ".fs/triage/finding-0.yaml",
            afterSha256: SHA_A,
          },
      },
    },
  );
  await waitFor(() =>
    expect(
      slot.container.querySelectorAll("[data-finding-row]").length,
    ).toBeGreaterThan(0),
  );
  return slot;
}

function confirmEditor(
  editor: HTMLElement,
  reason = "Reviewed the cached call graph evidence",
): void {
  fireEvent.change(within(editor).getByLabelText("Reason"), {
    target: { value: reason },
  });
  fireEvent.click(within(editor).getByRole("checkbox"));
}

describe("manual triage flow", () => {
  it("writes one valid decision, announces success, and advances", async () => {
    const slot = await renderFlow();
    fireEvent.keyDown(window, { key: "e" });
    const editor = await slot.findByRole("form", {
      name: /Triage CVE-2026-0/u,
    });
    confirmEditor(editor);
    fireEvent.keyDown(within(editor).getByLabelText("Reason"), {
      key: "Enter",
      metaKey: true,
    });
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "triageDecisionsWrite",
        ),
      ).toHaveLength(1),
    );
    const write = slot.inspection.rpcCalls.find(
      (call) => call.method === "triageDecisionsWrite",
    );
    expect(write?.input).toMatchObject({
      decisions: [
        {
          findingId: "finding-0",
          stableKey: "stable-0",
          status: "EXPLOITABLE",
        },
      ],
    });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-index")).toBe("1"),
    );
    expect(slot.getByText(/EXPLOITABLE written locally/u)).toBeTruthy();
  });

  it("blocks NOT_AFFECTED until a frozen justification is chosen", async () => {
    const slot = await renderFlow();
    fireEvent.keyDown(window, { key: "n" });
    const editor = await slot.findByRole("form", { name: /Triage/u });
    confirmEditor(editor);
    expect(
      within(editor).getByText("NOT_AFFECTED requires a justification."),
    ).toBeTruthy();
    expect(
      (
        within(editor).getByRole("button", {
          name: /Write YAML/u,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("forces CODE_NOT_REACHABLE to exact-version and explains the disabled promotion", async () => {
    const slot = await renderFlow();
    fireEvent.keyDown(window, { key: "n" });
    const editor = await slot.findByRole("form", { name: /Triage/u });
    const trigger = within(editor).getByLabelText(/Justification/u);
    fireEvent.click(trigger);
    const option = await slot.findByRole("option", {
      name: /CODE NOT REACHABLE/u,
    });
    fireEvent.click(option);
    expect(
      (within(editor).getByLabelText("Version pin") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(within(editor).getByText(/promotion is disabled/u)).toBeTruthy();
  });

  it("retains the draft and offers Reload/Compare on CAS conflict", async () => {
    const slot = await renderFlow({
      write: (input) => ({
        results: (
          input.decisions as Array<{ findingId: string; stableKey: string }>
        ).map((item) => ({
          success: false,
          findingId: item.findingId,
          stableKey: item.stableKey,
          code: "OVERLAY_CAS_CONFLICT",
          message: "Triage overlay changed concurrently.",
          retryable: true,
        })),
      }),
    });
    fireEvent.keyDown(window, { key: "e" });
    const editor = await slot.findByRole("form", { name: /Triage/u });
    confirmEditor(editor, "My carefully reviewed rationale");
    fireEvent.click(
      within(editor).getByRole("button", { name: /Write YAML/u }),
    );
    expect(
      await within(editor).findByText("A newer YAML file was preserved"),
    ).toBeTruthy();
    expect(
      (within(editor).getByLabelText("Reason") as HTMLTextAreaElement).value,
    ).toBe("My carefully reviewed rationale");
    expect(
      within(editor).getByRole("button", { name: "Reload CAS base" }),
    ).toBeTruthy();
    expect(
      within(editor).getByRole("button", { name: "Compare" }),
    ).toBeTruthy();
  });

  it("surfaces the registered writer returning no single-decision result", async () => {
    const slot = await renderFlow({ write: () => ({ results: [] }) });
    fireEvent.keyDown(window, { key: "e" });
    const editor = await slot.findByRole("form", { name: /Triage/u });
    confirmEditor(editor);
    fireEvent.click(
      within(editor).getByRole("button", { name: /Write YAML/u }),
    );

    expect(
      await within(editor).findByText("This decision was not written"),
    ).toBeTruthy();
    expect(
      within(editor).getByText("The local writer returned no result."),
    ).toBeTruthy();
  });

  it("surfaces a thrown registered-writer failure and preserves the draft", async () => {
    const slot = await renderFlow({
      write: () => {
        throw new Error("Filesystem denied the local YAML write");
      },
    });
    fireEvent.keyDown(window, { key: "e" });
    const editor = await slot.findByRole("form", { name: /Triage/u });
    confirmEditor(editor, "Keep this reviewed rationale after failure");
    fireEvent.click(
      within(editor).getByRole("button", { name: /Write YAML/u }),
    );

    expect(
      await within(editor).findByText("This decision was not written"),
    ).toBeTruthy();
    expect(
      within(editor).getByText("Filesystem denied the local YAML write"),
    ).toBeTruthy();
    expect(
      (within(editor).getByLabelText("Reason") as HTMLTextAreaElement).value,
    ).toBe("Keep this reviewed rationale after failure");
  });

  it("preserves bulk successes, lists individual failures, and retries only failures", async () => {
    let attempt = 0;
    const slot = await renderFlow({
      write: (input) => {
        attempt += 1;
        const decisions = input.decisions as Array<{
          findingId: string;
          stableKey: string;
        }>;
        return {
          results: decisions.map((item, index) =>
            attempt === 1 && index === 1
              ? {
                  success: false,
                  findingId: item.findingId,
                  stableKey: item.stableKey,
                  code: "OVERLAY_CAS_CONFLICT",
                  message: "Externally edited",
                  retryable: true,
                }
              : success(item.findingId, item.stableKey),
          ),
        };
      },
    });
    fireEvent.click(slot.getByRole("button", { name: "Select all 3" }));
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.click(slot.getByRole("button", { name: /eEXPLOITABLE/u }));
    const editor = await slot.findByRole("form", {
      name: /3 local overlay identities/u,
    });
    fireEvent.change(within(editor).getByLabelText("Reason"), {
      target: { value: "Reviewed each selected finding locally" },
    });
    fireEvent.change(within(editor).getByLabelText("Evidence reviewed"), {
      target: { value: "Reviewed cached evidence for each selected row" },
    });
    fireEvent.click(within(editor).getByRole("checkbox"));
    fireEvent.click(
      within(editor).getByRole("button", { name: /Write YAML/u }),
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Confirm local writes" }),
    );
    expect(
      await slot.findByText(
        /1 decision failed; successful YAML changes were kept/u,
      ),
    ).toBeTruthy();
    expect(slot.getByText(/stable-1: Externally edited/u)).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Retry failed" }));
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "triageDecisionsWrite",
        ),
      ).toHaveLength(2),
    );
    const retry = slot.inspection.rpcCalls
      .filter((call) => call.method === "triageDecisionsWrite")
      .at(-1);
    expect(retry?.input).toMatchObject({
      decisions: [{ findingId: "finding-1" }],
    });
    const calls = slot.inspection.rpcCalls;
    const targetReadIndexes = calls.flatMap((call, index) =>
      call.method === "triageTargetsRead" ? [index] : [],
    );
    expect(calls.findIndex((call) => call === retry)).toBeGreaterThan(
      targetReadIndexes.at(-1) ?? -1,
    );
  });

  it("uses command-enter for the repaired preview and confirmation gates", async () => {
    const slot = await renderFlow();
    fireEvent.click(slot.getByRole("button", { name: "Select all 3" }));
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.click(slot.getByRole("button", { name: /eEXPLOITABLE/u }));
    const editor = await slot.findByRole("form", {
      name: /3 local overlay identities/u,
    });
    confirmEditor(editor, "Reviewed every selected finding");
    fireEvent.keyDown(within(editor).getByLabelText("Reason"), {
      key: "Enter",
      metaKey: true,
    });
    const confirm = await slot.findByRole("button", {
      name: "Confirm local writes",
    });
    expect(document.activeElement).toBe(confirm);
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "triageDecisionsWrite",
      ),
    ).toHaveLength(0);
    const activeConfirm = document.activeElement;
    if (!activeConfirm)
      throw new Error("bulk confirmation did not receive focus");
    fireEvent.keyDown(activeConfirm, {
      key: "Enter",
      metaKey: true,
    });

    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "triageDecisionsWrite",
        ),
      ).toHaveLength(1),
    );
    expect(
      slot.getByText("3 local YAML decisions written; 0 failed."),
    ).toBeTruthy();
    expect(
      slot.queryByRole("form", { name: /3 local overlay identities/u }),
    ).toBeNull();
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "triageDecisionsWrite",
      ),
    ).toHaveLength(1);
  });

  it("single-flights rapid command-enter confirmation submissions", async () => {
    let releaseWrite = (): void => {};
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const slot = await renderFlow({
      write: async (input) => {
        await writeGate;
        return {
          results: (
            input.decisions as Array<{ findingId: string; stableKey: string }>
          ).map((item) => success(item.findingId, item.stableKey)),
        };
      },
    });
    fireEvent.click(slot.getByRole("button", { name: "Select all 3" }));
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.click(slot.getByRole("button", { name: /eEXPLOITABLE/u }));
    const editor = await slot.findByRole("form", {
      name: /3 local overlay identities/u,
    });
    const reason = within(editor).getByLabelText("Reason");
    confirmEditor(editor, "Reviewed every selected finding");
    fireEvent.keyDown(reason, { key: "Enter", metaKey: true });
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
    fireEvent.keyDown(activeConfirm, {
      key: "Enter",
      metaKey: true,
    });
    fireEvent.keyDown(activeConfirm, {
      key: "Enter",
      metaKey: true,
    });
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "triageDecisionsWrite",
        ),
      ).toHaveLength(1),
    );

    releaseWrite();
    await waitFor(() =>
      expect(
        slot.getByText("3 local YAML decisions written; 0 failed."),
      ).toBeTruthy(),
    );
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "triageDecisionsWrite",
      ),
    ).toHaveLength(1);
  });

  it("explains why command-enter cannot advance an unconfirmed draft", async () => {
    const slot = await renderFlow();
    fireEvent.click(slot.getByRole("button", { name: "Select all 3" }));
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.click(slot.getByRole("button", { name: /eEXPLOITABLE/u }));
    const editor = await slot.findByRole("form", {
      name: /3 local overlay identities/u,
    });
    fireEvent.change(within(editor).getByLabelText("Reason"), {
      target: { value: "Reviewed every selected finding" },
    });
    fireEvent.keyDown(within(editor).getByLabelText("Reason"), {
      key: "Enter",
      metaKey: true,
    });

    expect((await within(editor).findByRole("alert")).textContent).toMatch(
      /Confirm that you reviewed the reason and evidence/u,
    );
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "triageDecisionsWrite",
      ),
    ).toHaveLength(0);
  });

  it("retains a bulk draft's resolved scope across catalog loss and recovery", async () => {
    let catalogAvailable = true;
    const slot = await renderFlow({ catalogAvailable: () => catalogAvailable });
    fireEvent.click(slot.getByRole("button", { name: "Select all 3" }));
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.click(slot.getByRole("button", { name: /eEXPLOITABLE/u }));
    const editor = await slot.findByRole("form", {
      name: /3 local overlay identities/u,
    });
    fireEvent.change(within(editor).getByLabelText("Reason"), {
      target: { value: "Reviewed every selected finding locally" },
    });
    fireEvent.change(within(editor).getByLabelText("Evidence reviewed"), {
      target: { value: "Reviewed the evidence for every selected row" },
    });
    fireEvent.click(within(editor).getByRole("checkbox"));
    const write = within(editor).getByRole("button", { name: /Write YAML/u });
    expect((write as HTMLButtonElement).disabled).toBe(false);
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "triageTargetsRead",
      ),
    ).toHaveLength(2);

    catalogAvailable = false;
    await slot.behavior.emitRealtime("findings:changed", {
      projectVersionId: "different-version",
    });

    await waitFor(() =>
      expect((write as HTMLButtonElement).disabled).toBe(false),
    );
    expect(
      slot.queryByText(/no resolved project and version scope/u),
    ).toBeNull();

    catalogAvailable = true;
    await slot.behavior.emitRealtime("findings:changed", {
      projectVersionId: "version-1",
    });
    await waitFor(() =>
      expect(slot.getByText(/Local triage ready/u)).toBeTruthy(),
    );
    expect((write as HTMLButtonElement).disabled).toBe(false);
    expect(
      slot.queryByText(/no resolved project and version scope/u),
    ).toBeNull();
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "triageDecisionsWrite",
      ),
    ).toHaveLength(0);
  });

  it("undoes with the captured write scope after the live catalog becomes unresolved", async () => {
    let catalogAvailable = true;
    const undo = vi.fn(() => ({
      file: ".fs/triage/finding-0.yaml",
      afterSha256: SHA_A,
    }));
    const slot = await renderFlow({
      catalogAvailable: () => catalogAvailable,
      undo,
    });
    fireEvent.keyDown(window, { key: "e" });
    const editor = await slot.findByRole("form", { name: /Triage/u });
    confirmEditor(editor);

    catalogAvailable = false;
    await slot.behavior.emitRealtime("findings:changed", {
      projectVersionId: "different-version",
    });
    fireEvent.click(
      within(editor).getByRole("button", { name: /Write YAML/u }),
    );
    await waitFor(() =>
      expect(slot.queryByRole("form", { name: /Triage/u })).toBeNull(),
    );

    fireEvent.keyDown(window, { key: "u" });
    await waitFor(() => expect(undo).toHaveBeenCalledTimes(1));
    expect(undo).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceProjectId: "workspace-project-1",
        platformProjectId: "platform-project-1",
        projectVersionId: "version-1",
        findingId: "finding-0",
        stableKey: "stable-0",
      }),
    );
    expect(slot.getByText(/Undid the last local decision/u)).toBeTruthy();
    expect(slot.queryByText(/There is no local decision to undo/u)).toBeNull();
  });

  it("refreshes the CAS base across a 20-item chunk boundary", async () => {
    const findings = Array.from({ length: 27 }, (_, index) => finding(index));
    let currentSha = SHA_A;
    const slot = await renderFlow({
      findings,
      read: (input) => {
        const selection = input["selection"] as {
          mode: string;
          findingIds?: string[];
        };
        const ids =
          selection.mode === "predicate"
            ? findings.map((item) => item.key)
            : (selection.findingIds ?? []);
        return {
          items: ids.map((id) => target(id, currentSha, "gateway")),
          total: ids.length,
          next: null,
        };
      },
      write: (input) => {
        const decisions = input.decisions as Array<{
          findingId: string;
          stableKey: string;
          expectedSha256: string | null;
        }>;
        expect(
          decisions.every((item) => item.expectedSha256 === currentSha),
        ).toBe(true);
        currentSha = currentSha === SHA_A ? SHA_B : "c".repeat(64);
        return {
          results: decisions.map((item) => ({
            ...success(item.findingId, item.stableKey),
            afterSha256: currentSha,
            undo: {
              ...success(item.findingId, item.stableKey).undo,
              afterSha256: currentSha,
            },
          })),
        };
      },
    });
    fireEvent.click(slot.getByRole("button", { name: "Select all 27" }));
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.click(slot.getByRole("button", { name: /eEXPLOITABLE/u }));
    const editor = await slot.findByRole("form", {
      name: /27 local overlay identities/u,
    });
    fireEvent.change(within(editor).getByLabelText("Reason"), {
      target: { value: "Reviewed every selected finding locally" },
    });
    fireEvent.change(within(editor).getByLabelText("Evidence reviewed"), {
      target: { value: "Reviewed the evidence for every selected row" },
    });
    fireEvent.click(within(editor).getByRole("checkbox"));
    fireEvent.click(
      within(editor).getByRole("button", { name: /Write YAML/u }),
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Confirm local writes" }),
    );
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "triageDecisionsWrite",
        ),
      ).toHaveLength(2),
    );
    expect(slot.getByText(/27 succeeded, 0 failed/u)).toBeTruthy();
  });

  it("keeps per-key accounting when a later chunk loses an exact row during refresh", async () => {
    const findings = Array.from({ length: 25 }, (_, index) => finding(index));
    const slot = await renderFlow({
      findings,
      read: (input) => {
        const selection = input["selection"] as {
          mode: string;
          findingIds?: string[];
        };
        const ids =
          selection.mode === "predicate"
            ? findings.map((item) => item.key)
            : (selection.findingIds ?? []);
        const available =
          ids.length === 5 ? ids.filter((id) => id !== "finding-22") : ids;
        return {
          items: available.map((id) => target(id)),
          total: available.length,
          next: null,
        };
      },
    });
    fireEvent.click(slot.getByRole("button", { name: "Select all 25" }));
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.click(slot.getByRole("button", { name: /eEXPLOITABLE/u }));
    const editor = await slot.findByRole("form", {
      name: /25 local overlay identities/u,
    });
    fireEvent.change(within(editor).getByLabelText("Reason"), {
      target: { value: "Reviewed every selected finding locally" },
    });
    fireEvent.change(within(editor).getByLabelText("Evidence reviewed"), {
      target: { value: "Reviewed the evidence for every selected row" },
    });
    fireEvent.click(within(editor).getByRole("checkbox"));
    fireEvent.click(
      within(editor).getByRole("button", { name: /Write YAML/u }),
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Confirm local writes" }),
    );

    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "triageDecisionsWrite",
        ),
      ).toHaveLength(2),
    );
    const writes = slot.inspection.rpcCalls.filter(
      (call) => call.method === "triageDecisionsWrite",
    );
    expect(
      (writes[0]?.input as { decisions: unknown[] }).decisions,
    ).toHaveLength(20);
    expect(
      (writes[1]?.input as { decisions: unknown[] }).decisions,
    ).toHaveLength(4);
    expect(await slot.findByText(/24 succeeded, 1 failed/u)).toBeTruthy();
    expect(
      slot.getByText(
        /stable-22: The exact selected finding row finding-22 is no longer available/u,
      ),
    ).toBeTruthy();
    expect(
      (slot.getByRole("button", { name: "Retry failed" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "findingsUiList",
        ).length,
      ).toBeGreaterThan(1),
    );
  });

  it("shows and preserves the prior local decision before replacement", async () => {
    const prior = {
      status: "NOT_AFFECTED" as const,
      justification: "CODE_NOT_PRESENT" as const,
      response: "WILL_NOT_FIX" as const,
      reason: "Previously reviewed authored rationale",
      pin: "any_version" as const,
      provenance: {
        by: "reviewer",
        at: "2026-08-13T01:00:00.000Z",
        evidence: "Previously reviewed evidence",
      },
      sync: { base: null, pushed_at: null },
    };
    const slot = await renderFlow({
      read: (input) => {
        const selection = input["selection"] as { findingIds?: string[] };
        return {
          items: (selection.findingIds ?? []).map((id) => ({
            ...target(id, SHA_A),
            prior,
          })),
          total: 1,
          next: null,
        };
      },
    });
    fireEvent.keyDown(window, { key: "e" });
    const editor = await slot.findByRole("form", { name: /Triage/u });
    const existing = within(editor).getByRole("region", {
      name: "Existing local decision being replaced",
    });
    expect(
      within(existing).getByText("Previously reviewed authored rationale"),
    ).toBeTruthy();
    expect(
      (within(editor).getByLabelText("Reason") as HTMLTextAreaElement).value,
    ).toBe(prior.reason);
    expect(
      (
        within(editor).getByLabelText(
          "Evidence reviewed",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe(prior.provenance.evidence);
    expect(
      within(editor).getByText("Not required for EXPLOITABLE."),
    ).toBeTruthy();
    fireEvent.click(within(editor).getByRole("checkbox"));
    fireEvent.click(
      within(editor).getByRole("button", { name: /Write YAML/u }),
    );
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "triageDecisionsWrite",
        ),
      ).toHaveLength(1),
    );
    const write = slot.inspection.rpcCalls.find(
      (call) => call.method === "triageDecisionsWrite",
    );
    expect(write?.input).toMatchObject({
      decisions: [{ status: "EXPLOITABLE", justification: null }],
    });
  });

  it("writes one exact row for a selected collision identity and discloses the shared sibling", async () => {
    const first = finding(0);
    const sibling = finding(1);
    first.fields.stableKey = "shared-stable";
    sibling.fields.stableKey = "shared-stable";
    const slot = await renderFlow({
      findings: [first, sibling],
      read: (input) => {
        const selection = input["selection"] as { findingIds?: string[] };
        const ids = selection.findingIds ?? [];
        return {
          items: ids.map((id) => ({
            ...target(id),
            stableKey: "shared-stable",
          })),
          total: ids.length,
          next: null,
        };
      },
    });
    fireEvent.keyDown(window, { key: "x" });
    fireEvent.keyDown(window, { key: "b" });
    expect(
      slot.getByText(/1 additional rendered collision row shares/u),
    ).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: /eEXPLOITABLE/u }));
    const editor = await slot.findByRole("form", {
      name: /1 local overlay identity/u,
    });
    confirmEditor(editor);
    fireEvent.click(
      within(editor).getByRole("button", { name: /Write YAML/u }),
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Confirm local writes" }),
    );
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "triageDecisionsWrite",
        ),
      ).toHaveLength(1),
    );
    const write = slot.inspection.rpcCalls.find(
      (call) => call.method === "triageDecisionsWrite",
    );
    expect(write?.input).toMatchObject({
      decisions: [{ findingId: "finding-0", stableKey: "shared-stable" }],
    });
    expect((write?.input as { decisions: unknown[] }).decisions).toHaveLength(
      1,
    );
  });

  it("fails undo closed after an external edit", async () => {
    const slot = await renderFlow({
      undo: () =>
        Promise.reject(new Error("Triage overlay changed concurrently")),
    });
    fireEvent.keyDown(window, { key: "e" });
    const editor = await slot.findByRole("form", { name: /Triage/u });
    confirmEditor(editor);
    fireEvent.click(
      within(editor).getByRole("button", { name: /Write YAML/u }),
    );
    await waitFor(() =>
      expect(slot.queryByRole("form", { name: /Triage/u })).toBeNull(),
    );
    fireEvent.keyDown(window, { key: "u" });
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(
      /Undo refused: Triage overlay changed concurrently/u,
    );
  });
});

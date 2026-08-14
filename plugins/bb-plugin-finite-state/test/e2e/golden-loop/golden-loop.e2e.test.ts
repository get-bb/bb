// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import type { createFakePluginHost } from "@bb/plugin-sdk/testing";
import type { PluginNavPanelProps } from "@bb/plugin-sdk/app";
import {
  installTestPluginRuntime,
  loadPluginApp,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";
import {
  cleanup,
  configure,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { assertion, fileAssertion } from "./assertions.js";
import { createGoldenLoopHarness, type GoldenLoopHarness } from "./harness.js";
import { semanticReport } from "./reporter.js";
import { GOLDEN_LOOP_BEATS, type GoldenLoopBeat } from "./scenario.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../../../..");
const FIXTURE_ROOT = resolve(import.meta.dirname, "../../mock-remote/fixtures");
const WORKSPACE_PROJECT_ID = "workspace-golden-loop";
const BENCH_VERSION = "pv-a481df87dadf";
const execFileAsync = promisify(execFile);

interface Runtime {
  host: ReturnType<typeof createFakePluginHost>;
  worktree: string;
  projectId: string;
  findingVersion: string;
  fs167Version: string;
  bomVersion: string;
  fs193Version: string;
  findings: Map<string, Record<string, unknown>>;
  versions: Map<string, Record<string, unknown>>;
  evidence: Map<string, unknown>;
  failSbom: boolean;
  failNextTriageWrite: boolean;
  failNextThreadSpawn: boolean;
  firmwareReady: Set<string>;
  benchReady: boolean;
  panelRpcCalls: Array<Readonly<{ method: string; input: unknown }>>;
  fs167ReviewPlanCalls: number;
  panelPlan: Record<string, unknown> | null;
  humanPushApproved: boolean;
  executeHumanPush(input: unknown): Promise<unknown>;
  refreshOverlayIndex(): Promise<void>;
  human: GoldenLoopHarness["human"] | null;
}

class GoldenLoopResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() =>
      this.callback(
        [
          {
            target,
            contentRect: new DOMRectReadOnly(0, 0, 1200, 640),
            borderBoxSize: [{ blockSize: 640, inlineSize: 1200 }],
            contentBoxSize: [{ blockSize: 640, inlineSize: 1200 }],
            devicePixelContentBoxSize: [{ blockSize: 640, inlineSize: 1200 }],
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
  vi.stubGlobal("ResizeObserver", GoldenLoopResizeObserver);
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
    get: () => 640,
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

const FAKE_UNPACK_WRAPPER = String.raw`
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
const argv = process.argv.slice(2);
const input = argv[0];
const output = argv[argv.indexOf("-d") + 1];
const snapshotPath = argv[argv.indexOf("-o") + 1];
const bytes = await readFile(input);
const payload = Buffer.from("golden:" + bytes.toString());
const inputHash = createHash("sha256").update(bytes).digest("hex");
const fileHash = createHash("sha256").update(payload).digest("hex");
await mkdir(join(output, "bin"), { recursive: true });
await writeFile(join(output, "bin", "firmware.txt"), payload);
await writeFile(snapshotPath, JSON.stringify({
  input_file: basename(input),
  input_sha256: inputHash,
  file_tree: [{
    file_path: "/bin/firmware.txt",
    file_hash: fileHash,
    file_name: "firmware.txt",
    mime_type: "text/plain",
    full_type: "ASCII text",
    file_size: payload.length,
  }],
  unpack_metadata: {},
  errors: [],
}));
`;

function human(runtime: Runtime): GoldenLoopHarness["human"] {
  if (runtime.human === null) {
    throw new Error("Golden Loop human actions are not initialized");
  }
  return runtime.human;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is not a string`);
  }
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number") throw new Error(`${label} is not a number`);
  return value;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function metadata(number: number) {
  const beat = GOLDEN_LOOP_BEATS.find(
    (candidate) => candidate.number === number,
  );
  if (!beat) throw new Error(`Missing Golden Loop metadata for beat ${number}`);
  return beat;
}

function fs167FindingId(index: number): string {
  return String(16_700_000 + index);
}

function successfulCli(value: unknown): boolean {
  const result = object(value, "CLI result");
  return result["exitCode"] === 0 && result["stderr"] === "";
}

function cliContext() {
  return { projectId: WORKSPACE_PROJECT_ID, threadId: "thread-golden-loop" };
}

async function ensureFindingPull(runtime: Runtime): Promise<void> {
  if (runtime.evidence.has("finding-pull")) return;
  const result = await runtime.host.harness.behavior.callRpc("syncPull", {
    workspaceProjectId: WORKSPACE_PROJECT_ID,
    projectId: runtime.projectId,
    projectVersionId: runtime.findingVersion,
    kinds: ["finding"],
  });
  runtime.evidence.set("finding-pull", result);
}

async function triageTargets(runtime: Runtime, findingIds: readonly string[]) {
  await ensureFindingPull(runtime);
  return object(
    await runtime.host.harness.behavior.callRpc("triageTargetsRead", {
      workspaceProjectId: WORKSPACE_PROJECT_ID,
      platformProjectId: runtime.projectId,
      projectVersionId: runtime.findingVersion,
      selection: { mode: "exact", findingIds },
      continuation: null,
    }),
    "triage target page",
  );
}

function decision(
  target: unknown,
  reason: string,
  status: "IN_TRIAGE" | "NOT_AFFECTED" = "NOT_AFFECTED",
) {
  const item = object(target, "triage target");
  const evidence =
    typeof item["evidence"] === "string" && item["evidence"].length > 0
      ? item["evidence"]
      : typeof item["reasonSeed"] === "string" && item["reasonSeed"].length > 0
        ? item["reasonSeed"]
        : "Golden Loop cached finding evidence";
  return {
    findingId: string(item["findingId"], "finding id"),
    stableKey: string(item["stableKey"], "stable key"),
    status,
    justification: status === "NOT_AFFECTED" ? "CODE_NOT_REACHABLE" : null,
    response: null,
    reason,
    evidence,
    pin: status === "NOT_AFFECTED" ? "exact_version" : "any_version",
    expectedSha256:
      typeof item["expectedSha256"] === "string"
        ? item["expectedSha256"]
        : null,
  };
}

async function registeredPanel(path: string) {
  const app = await loadPluginApp(() => import("../../../app.js"));
  const panels = app.navPanels.filter((candidate) => candidate.path === path);
  if (panels.length !== 1 || !panels[0]) {
    throw new Error(`Expected exactly one registered ${path} panel`);
  }
  return panels[0];
}

async function registeredSyncPanelWithHumanApproval() {
  const registered = await registeredPanel("sync");
  const [panelModule, contract] = await Promise.all([
    import("../../../lanes/sync/ui/SyncReviewPanel.js"),
    import("../../../shared/contract.js"),
  ]);
  if (registered.component !== panelModule.SyncReviewPanel) {
    throw new Error("Registered Sync panel does not use SyncReviewPanel");
  }
  const capability = contract.humanApprovalCapabilitySchema.parse(
    "golden-loop-human-approval-capability",
  );
  return {
    ...registered,
    component: (props: PluginNavPanelProps) =>
      createElement(panelModule.SyncReviewPanel, {
        ...props,
        humanApprovalCapability: capability,
      }),
  };
}

async function panelPlanPage(
  runtime: Runtime,
  input: unknown,
): Promise<Record<string, unknown>> {
  const request = object(input, "sync plan input");
  const continuation =
    request["continuation"] === null
      ? null
      : string(request["continuation"], "sync plan continuation");
  let offset = 0;
  if (continuation === null) {
    const projectId = string(request["projectId"], "sync plan project");
    const projectVersionId = string(
      request["projectVersionId"],
      "sync plan version",
    );
    const surface = array(request["kinds"], "sync plan kinds");
    if (surface.length !== 1)
      throw new Error("Panel plan requires one surface");
    const result = await runtime.host.harness.behavior.runCli(
      [
        "finite-state",
        "plan",
        string(surface[0], "sync plan surface"),
        "--project",
        projectId,
        "--version",
        projectVersionId,
        "--json",
      ],
      cliContext(),
    );
    if (!successfulCli(result)) {
      throw new Error(
        `Panel plan failed: ${String(object(result, "plan result")["stderr"])}`,
      );
    }
    runtime.panelPlan = object(
      JSON.parse(string(object(result, "plan result")["stdout"], "plan JSON")),
      "panel plan",
    );
  } else {
    const matched = /^fsp1:([^:]+):(\d+)$/u.exec(continuation);
    if (!matched) throw new Error("Invalid panel plan continuation");
    offset = Number(matched[2]);
    if (runtime.panelPlan?.["planId"] !== matched[1]) {
      throw new Error("Panel plan continuation is stale");
    }
  }
  if (runtime.panelPlan === null) throw new Error("Panel plan is unavailable");
  const items = array(runtime.panelPlan["items"], "panel plan items");
  const pageSize = number(request["pageSize"], "sync plan page size");
  const pageItems = items.slice(offset, offset + pageSize);
  const nextOffset = offset + pageItems.length;
  return {
    ...runtime.panelPlan,
    items: pageItems,
    validationErrors: pageItems.flatMap((item) => {
      const error = object(item, "plan item")["error"];
      return error === null ? [] : [error];
    }),
    total: items.length,
    next:
      nextOffset < items.length
        ? `fsp1:${string(runtime.panelPlan["planId"], "plan id")}:${nextOffset}`
        : null,
  };
}

function registeredRpc(
  runtime: Runtime,
): Record<string, (input: unknown) => Promise<unknown> | unknown> {
  const connected = {
    platform: { state: "connected", message: null, checkedAt: null },
    assuranceStudio: { state: "connected", message: null, checkedAt: null },
    forgeCompute: { state: "disabled", message: null, checkedAt: null },
  };
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "connectionsStatus") return () => connected;
        if (typeof property !== "string") return undefined;
        return async (input: unknown) => {
          runtime.panelRpcCalls.push({ method: property, input });
          if (property === "syncPlan") return panelPlanPage(runtime, input);
          if (property === "syncPush") {
            if (!runtime.humanPushApproved) {
              throw new Error("Golden Loop push requires explicit human.push");
            }
            runtime.humanPushApproved = false;
            try {
              const report = await runtime.executeHumanPush(input);
              runtime.panelPlan = null;
              runtime.evidence.set("human-push-report", report);
              return report;
            } catch (error) {
              runtime.evidence.set(
                "human-push-error",
                error instanceof Error ? error.message : String(error),
              );
              throw error;
            }
          }
          if (
            property === "triageDecisionsWrite" &&
            runtime.failNextTriageWrite
          ) {
            runtime.failNextTriageWrite = false;
            return {
              results: array(
                object(input, "triage write input")["decisions"],
                "triage decisions",
              ).map((decision) => {
                const item = object(decision, "triage decision");
                return {
                  success: false,
                  findingId: string(item["findingId"], "finding id"),
                  stableKey: string(item["stableKey"], "stable key"),
                  code: "OVERLAY_CAS_CONFLICT",
                  message: "induced registered-panel write conflict",
                  retryable: true,
                };
              }),
            };
          }
          return runtime.host.harness.behavior.callRpc(property, input);
        };
      },
    },
  );
}

function panelRuntime(runtime: Runtime) {
  return {
    context: { projectId: WORKSPACE_PROJECT_ID },
    sidebarThreads: {
      status: "ready" as const,
      projects: [
        {
          id: WORKSPACE_PROJECT_ID,
          name: "Golden Loop",
          isPersonal: false,
        },
      ],
    },
    rpc: registeredRpc(runtime),
  };
}

async function filesBelow(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await walk(root);
  return files.sort();
}

async function ensureFirmware(runtime: Runtime, pvId: string): Promise<void> {
  if (runtime.firmwareReady.has(pvId)) return;
  const pull = await runtime.host.harness.behavior.runCli(
    ["finite-state", "firmware", "pull", pvId, "--source", "api"],
    { projectId: runtime.projectId, threadId: "thread-firmware-golden" },
  );
  if (!successfulCli(pull)) {
    throw new Error(
      `Firmware pull failed: ${String(object(pull, "firmware pull")["stderr"])}`,
    );
  }
  await waitFor(async () => {
    const page = object(
      await runtime.host.harness.behavior.callRpc("firmwareMountsList", {
        projectId: runtime.projectId,
        projectVersionId: pvId,
        pageSize: 100,
        continuation: null,
      }),
      "firmware mounts",
    );
    const mount = array(page["items"], "firmware mount rows")
      .map((item) => object(item, "firmware mount"))
      .find((item) => item["projectVersionId"] === pvId);
    const fields = object(
      object(mount, "selected firmware mount")["fields"],
      "firmware mount fields",
    );
    const apiMetadataReady =
      fields["source"] === "api" &&
      fields["state"] === "metadata_only" &&
      number(fields["files"], "firmware files") > 0 &&
      typeof fields["artifactHash"] === "string";
    if (!apiMetadataReady) {
      throw new Error(`firmware mount is not ready: ${JSON.stringify(fields)}`);
    }
  });
  runtime.firmwareReady.add(pvId);
}

async function ensureBenchReady(runtime: Runtime): Promise<void> {
  if (runtime.benchReady) return;
  await runtime.host.harness.behavior.callRpc("syncPull", {
    workspaceProjectId: WORKSPACE_PROJECT_ID,
    projectId: runtime.projectId,
    projectVersionId: BENCH_VERSION,
    kinds: ["verificationRun"],
  });
  await ensureFirmware(runtime, BENCH_VERSION);
  runtime.benchReady = true;
}

async function mountedFirmwareDigest(
  runtime: Runtime,
  pvId: string,
): Promise<string> {
  const page = object(
    await runtime.host.harness.behavior.callRpc("firmwareMountsList", {
      projectId: runtime.projectId,
      projectVersionId: pvId,
      pageSize: 100,
      continuation: null,
    }),
    "firmware mounts",
  );
  const mount = array(page["items"], "firmware mount rows")
    .map((item) => object(item, "firmware mount"))
    .find((item) => item["projectVersionId"] === pvId);
  const fields = object(mount?.["fields"], "firmware mount fields");
  return string(
    fields["artifactHash"] ?? fields["inputSha256"],
    "firmware digest",
  );
}

async function ensureSbomPull(runtime: Runtime): Promise<void> {
  if (runtime.evidence.has("sbom-pull")) return;
  const result = await runtime.host.harness.behavior.runCli(
    [
      "finite-state",
      "pull",
      "sbomComponent",
      "--project",
      runtime.projectId,
      "--version",
      runtime.bomVersion,
      "--json",
    ],
    cliContext(),
  );
  if (!successfulCli(result)) {
    throw new Error(
      `Initial SBOM pull failed: ${object(result, "result")["stderr"]}`,
    );
  }
  runtime.evidence.set("sbom-pull", result);
}

async function authorFs167Decisions(runtime: Runtime): Promise<unknown> {
  const pull = await runtime.host.harness.behavior.callRpc("syncPull", {
    workspaceProjectId: WORKSPACE_PROJECT_ID,
    projectId: runtime.projectId,
    projectVersionId: runtime.fs167Version,
    kinds: ["finding", "vexDecision"],
  });
  const findingIds = Array.from({ length: 201 }, (_, index) =>
    fs167FindingId(index + 1),
  );
  for (let offset = 0; offset < findingIds.length; offset += 20) {
    const selected = findingIds.slice(offset, offset + 20);
    const page = object(
      await runtime.host.harness.behavior.callRpc("triageTargetsRead", {
        workspaceProjectId: WORKSPACE_PROJECT_ID,
        platformProjectId: runtime.projectId,
        projectVersionId: runtime.fs167Version,
        selection: { mode: "exact", findingIds: selected },
        continuation: null,
      }),
      "FS-167 triage targets",
    );
    const targets = array(page["items"], "FS-167 target rows");
    if (targets.length !== selected.length) {
      throw new Error(
        `FS-167 target read returned ${targets.length} of ${selected.length}`,
      );
    }
    const written = object(
      await runtime.host.harness.behavior.callRpc("triageDecisionsWrite", {
        workspaceProjectId: WORKSPACE_PROJECT_ID,
        platformProjectId: runtime.projectId,
        projectVersionId: runtime.fs167Version,
        decisions: targets.map((target) =>
          decision(target, "Golden Loop FS-167 clean baseline", "IN_TRIAGE"),
        ),
      }),
      "FS-167 triage writes",
    );
    const failures = array(written["results"], "FS-167 write results")
      .map((result) => object(result, "FS-167 write result"))
      .filter((result) => result["success"] !== true);
    if (failures.length > 0) {
      throw new Error(
        `FS-167 authored writes failed: ${JSON.stringify(failures)}`,
      );
    }
  }
  await execFileAsync("git", ["add", ".fs/triage"], {
    cwd: runtime.worktree,
  });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Finite State Golden Loop",
      "-c",
      "user.email=golden-loop@finite-state.test",
      "commit",
      "-m",
      "test: seed FS-167 clean triage baseline",
    ],
    { cwd: runtime.worktree },
  );
  const guardedPull = await runtime.host.harness.behavior.runCli(
    [
      "finite-state",
      "pull",
      "vexDecision",
      "--project",
      runtime.projectId,
      "--version",
      runtime.fs167Version,
      "--json",
    ],
    cliContext(),
  );
  if (!successfulCli(guardedPull)) {
    throw new Error(
      `FS-167 guarded pull failed: ${String(object(guardedPull, "guarded pull")["stderr"])}`,
    );
  }
  for (let offset = 0; offset < findingIds.length; offset += 20) {
    const selected = findingIds.slice(offset, offset + 20);
    const page = object(
      await runtime.host.harness.behavior.callRpc("triageTargetsRead", {
        workspaceProjectId: WORKSPACE_PROJECT_ID,
        platformProjectId: runtime.projectId,
        projectVersionId: runtime.fs167Version,
        selection: { mode: "exact", findingIds: selected },
        continuation: null,
      }),
      "FS-167 guarded triage targets",
    );
    const targets = array(page["items"], "FS-167 guarded target rows");
    const written = object(
      await runtime.host.harness.behavior.callRpc("triageDecisionsWrite", {
        workspaceProjectId: WORKSPACE_PROJECT_ID,
        platformProjectId: runtime.projectId,
        projectVersionId: runtime.fs167Version,
        decisions: targets.map((target) =>
          decision(target, "Golden Loop FS-167 reviewed paging decision"),
        ),
      }),
      "FS-167 guarded triage writes",
    );
    const failures = array(written["results"], "FS-167 guarded write results")
      .map((result) => object(result, "FS-167 guarded write result"))
      .filter((result) => result["success"] !== true);
    if (failures.length > 0) {
      throw new Error(
        `FS-167 guarded writes failed: ${JSON.stringify(failures)}`,
      );
    }
  }
  await runtime.refreshOverlayIndex();
  return { pull, guardedPull };
}

function beats(runtime: Runtime): GoldenLoopBeat[] {
  const list: GoldenLoopBeat[] = [
    {
      ...metadata(1),
      action: async ({ artifacts }) => {
        cleanup();
        const pull = await authorFs167Decisions(runtime);
        runtime.panelRpcCalls.length = 0;
        const slot = renderSlot(
          await registeredSyncPanelWithHumanApproval(),
          {
            subPath: `scope/${runtime.projectId}/${runtime.fs167Version}/surface/vexDecision`,
          },
          panelRuntime(runtime),
        );
        expect(
          await slot.findByText(
            (_content, element) =>
              element?.tagName === "P" &&
              element.textContent === "vexDecision · 201 proposed changes",
          ),
        ).toBeTruthy();
        const updateGroup = slot.container.querySelector<HTMLElement>(
          '[data-plan-group="update"]',
        );
        if (!updateGroup)
          throw new Error("Sync panel omitted its Updates group");
        expect(within(updateGroup).getByText("201")).toBeTruthy();
        await waitFor(() =>
          expect(
            runtime.panelRpcCalls.filter(({ method }) => method === "syncPlan")
              .length,
          ).toBeGreaterThan(1),
        );
        const reviewCalls = [...runtime.panelRpcCalls];
        runtime.fs167ReviewPlanCalls = reviewCalls.filter(
          ({ method }) => method === "syncPlan",
        ).length;
        await human(runtime).reviewDiff({
          beat: 1,
          changes: 201,
          surface: "vexDecision",
        });
        fireEvent.click(
          slot.getByRole("checkbox", {
            name: "Confirm reviewed blast radius",
          }),
        );
        await human(runtime).push({ beat: 1, changes: 201 });
        fireEvent.click(
          slot.getByRole("button", { name: "Push reviewed plan" }),
        );
        await waitFor(() =>
          expect(
            runtime.evidence.has("human-push-report") ||
              runtime.evidence.has("human-push-error"),
          ).toBe(true),
        );
        if (runtime.evidence.has("human-push-error")) {
          throw new Error(
            `Human push failed: ${String(runtime.evidence.get("human-push-error"))}`,
          );
        }
        const pushReport = object(
          runtime.evidence.get("human-push-report"),
          "human push report",
        );
        const pushSummary = object(pushReport["summary"], "human push summary");
        if (
          pushReport["status"] !== "completed" ||
          pushSummary["applied"] !== 201
        ) {
          throw new Error(
            `Human push was incomplete: ${JSON.stringify(pushReport)}`,
          );
        }
        expect(
          await slot.findByRole("button", {
            name: "Open Sync review: 0 local changes and 0 conflicts",
          }),
        ).toBeTruthy();
        const rpcStatus = await runtime.host.harness.behavior.callRpc(
          "syncStatus",
          {
            projectId: runtime.projectId,
            projectVersionId: runtime.fs167Version,
            kinds: ["vexDecision"],
          },
        );
        const cliStatusResult = await runtime.host.harness.behavior.runCli(
          [
            "finite-state",
            "status",
            "vexDecision",
            "--project",
            runtime.projectId,
            "--version",
            runtime.fs167Version,
            "--json",
          ],
          cliContext(),
        );
        if (!successfulCli(cliStatusResult)) {
          throw new Error("FS-167 durable status read failed");
        }
        const cliStatus = object(
          JSON.parse(
            string(
              object(cliStatusResult, "FS-167 status result")["stdout"],
              "FS-167 status JSON",
            ),
          ),
          "FS-167 durable status",
        );
        runtime.evidence.set("fs167-accept", {
          rpcStatus,
          cliStatus,
          pushReport,
        });
        await artifacts.writeJson("sync-panel-transcript.json", {
          pull,
          reviewCalls,
          acceptedCalls: runtime.panelRpcCalls,
          rpcStatus,
          cliStatus,
          pushReport,
        });
        await artifacts.writeText(
          "sync-review.dom.html",
          slot.container.innerHTML,
        );
        slot.unmount();
      },
      assert: async () => {
        const accept = object(
          runtime.evidence.get("fs167-accept"),
          "FS-167 accept evidence",
        );
        const rpcStatus = object(accept["rpcStatus"], "FS-167 RPC status");
        const cliStatus = object(accept["cliStatus"], "FS-167 CLI status");
        const pushReport = object(accept["pushReport"], "FS-167 push report");
        const pushSummary = object(
          pushReport["summary"],
          "FS-167 push summary",
        );
        const acceptedPushCalls = runtime.panelRpcCalls.filter(
          ({ method }) => method === "syncPush",
        );
        return [
          assertion(
            "fresh VEX generation is durably accepted",
            typeof object(
              rpcStatus["acceptedGenerationIds"],
              "accepted generations",
            )["vexDecision"] === "string",
          ),
          assertion(
            "registered panel drained more than one plan page",
            runtime.fs167ReviewPlanCalls > 1,
          ),
          assertion(
            "human-reviewed panel accept completed",
            acceptedPushCalls.length === 1 &&
              pushReport["status"] === "completed" &&
              pushSummary["applied"] === 201 &&
              array(cliStatus["local"], "durable local sync changes").length ===
                0,
          ),
        ];
      },
    },
    {
      ...metadata(2),
      action: async ({ artifacts }) => {
        cleanup();
        await ensureFindingPull(runtime);
        const slot = renderSlot(
          await registeredPanel("findings"),
          { subPath: "" },
          panelRuntime(runtime),
        );
        await waitFor(() =>
          expect(
            slot.container.querySelectorAll("[data-finding-row]"),
          ).toHaveLength(3),
        );
        fireEvent.click(slot.getByRole("button", { name: "Select all 3" }));
        fireEvent.keyDown(window, { key: "b" });
        fireEvent.click(slot.getByRole("button", { name: /eEXPLOITABLE/u }));
        const editor = await slot.findByRole("form", {
          name: /3 local overlay identities/u,
        });
        fireEvent.change(within(editor).getByLabelText("Reason"), {
          target: { value: "Golden Loop registered-panel bulk review" },
        });
        fireEvent.change(within(editor).getByLabelText("Evidence reviewed"), {
          target: { value: "Golden Loop cached finding rows and reachability" },
        });
        fireEvent.click(within(editor).getByRole("checkbox"));
        fireEvent.click(
          within(editor).getByRole("button", { name: /Write YAML/u }),
        );
        const confirm = await slot.findByRole("button", {
          name: "Confirm local writes",
        });
        runtime.failNextTriageWrite = true;
        fireEvent.keyDown(confirm, { key: "Enter", metaKey: true });
        const failure = await slot.findByRole("alert");
        expect(failure.textContent).toContain("decisions failed");
        fireEvent.click(
          within(failure).getByRole("button", { name: "Retry failed" }),
        );
        expect(
          await slot.findByText("3 local YAML decisions written; 0 failed."),
        ).toBeTruthy();
        await artifacts.writeText(
          "triage-panel.dom.html",
          slot.container.innerHTML,
        );
        slot.unmount();
      },
      assert: async ({ worktree }) => {
        const files = (
          await filesBelow(join(worktree, ".fs", "triage"))
        ).filter((file) => file.endsWith(".yaml"));
        const yaml = (
          await Promise.all(files.map((file) => readFile(file, "utf8")))
        ).join("\n");
        return [
          assertion(
            "registered panel wrote all selected decisions durably",
            files.length > 0 &&
              ["CVE-2026-65001", "CVE-2026-65002", "CVE-2026-65003"].every(
                (cve) => yaml.includes(cve),
              ),
          ),
          assertion(
            "durable YAML contains the user-selected status",
            (yaml.match(/status: EXPLOITABLE/gu) ?? []).length === 3,
          ),
        ];
      },
    },
    {
      ...metadata(3),
      expectedFailure: {
        task: "FS-201",
        reason: "the production Bench bootstrap path has not landed",
        signature: "No puller is registered for verificationRun",
      },
      setup: async () => ensureBenchReady(runtime),
      action: async ({ artifacts }) => {
        cleanup();
        const panel = await registeredPanel("bench");
        const slot = renderSlot(panel, { subPath: "" }, panelRuntime(runtime));
        expect(
          await slot.findByRole("option", {
            name: `${runtime.projectId} / ${BENCH_VERSION}`,
          }),
        ).toBeTruthy();
        const runButtons = await slot.findAllByRole("button", { name: "Run" });
        fireEvent.click(runButtons[0]!);
        fireEvent.change(await slot.findByLabelText("Host"), {
          target: { value: "golden-host" },
        });
        fireEvent.click(
          slot.getByLabelText(
            /I confirm this version, host, firmware digest, and deployment scope/u,
          ),
        );
        runtime.failNextThreadSpawn = true;
        fireEvent.click(slot.getByRole("button", { name: "Start Tier 0" }));
        await waitFor(() =>
          expect(
            slot.inspection.navigateCalls.some(
              (call) =>
                call.method === "toPluginPanel" &&
                call.path === "bench" &&
                typeof call.options?.subPath === "string" &&
                call.options.subPath.length > 0,
            ),
          ).toBe(true),
        );
        const runs = await runtime.host.harness.behavior.callRpc(
          "benchRunsList",
          {
            projectId: runtime.projectId,
            projectVersionId: BENCH_VERSION,
            pageSize: 20,
            continuation: null,
          },
        );
        const failed = array(object(runs, "runs")["items"], "run rows")
          .map((item) => object(item, "run row"))
          .find(
            (item) =>
              object(item["fields"], "run fields")["status"] === "failed",
          );
        const runId = string(failed?.["key"], "failed run id");
        slot.unmount();
        const detail = renderSlot(
          panel,
          { subPath: runId },
          panelRuntime(runtime),
        );
        expect(
          await detail.findAllByText(
            "induced registered bench dispatch failure",
          ),
        ).not.toHaveLength(0);
        await artifacts.writeJson("bench-failed-dispatch.json", { runs });
        await artifacts.writeText(
          "bench-failed-dispatch.dom.html",
          detail.container.innerHTML,
        );
        detail.unmount();
      },
      assert: async () => {
        const page = object(
          await runtime.host.harness.behavior.callRpc("benchRunsList", {
            projectId: runtime.projectId,
            projectVersionId: BENCH_VERSION,
            pageSize: 20,
            continuation: null,
          }),
          "runs",
        );
        const rows = array(page["items"], "run rows").map((item) =>
          object(item, "run row"),
        );
        return [
          assertion(
            "failed panel dispatch leaves a durable visible run row",
            rows.some((row) => {
              const fields = object(row["fields"], "run fields");
              return (
                fields["status"] === "failed" &&
                fields["failureReason"] ===
                  "induced registered bench dispatch failure"
              );
            }),
          ),
        ];
      },
    },
    {
      ...metadata(4),
      action: async ({ artifacts }) => {
        cleanup();
        await ensureSbomPull(runtime);
        runtime.failSbom = true;
        const failed = await runtime.host.harness.behavior.runCli(
          [
            "finite-state",
            "pull",
            "sbomComponent",
            "--project",
            runtime.projectId,
            "--version",
            runtime.bomVersion,
          ],
          cliContext(),
        );
        const slot = renderSlot(
          await registeredPanel("bom"),
          { subPath: "software" },
          panelRuntime(runtime),
        );
        await waitFor(() =>
          expect(
            slot.container.querySelectorAll("[data-sbom-row]").length,
          ).toBeGreaterThan(0),
        );
        fireEvent.click(slot.getByRole("button", { name: "Pull again" }));
        const pullFailure = await slot.findByRole("alert");
        expect(pullFailure.textContent).toMatch(/Pull generation|SBOM/u);
        runtime.failSbom = false;
        fireEvent.click(slot.getByRole("button", { name: "Pull again" }));
        await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
        const page = await runtime.host.harness.behavior.callRpc(
          "bomSoftwareList",
          {
            projectId: runtime.projectId,
            projectVersionId: runtime.bomVersion,
            pageSize: 100,
            continuation: null,
            filters: {},
          },
        );
        await artifacts.writeJson("sbom-recovery-transcript.json", {
          failed,
          page,
        });
        await artifacts.writeText(
          "sbom-recovery.dom.html",
          slot.container.innerHTML,
        );
        slot.unmount();
      },
      assert: async () => {
        const page = object(
          await runtime.host.harness.behavior.callRpc("bomSoftwareList", {
            projectId: runtime.projectId,
            projectVersionId: runtime.bomVersion,
            pageSize: 100,
            continuation: null,
            filters: {},
          }),
          "SBOM page",
        );
        return [
          assertion(
            "registered panel retry publishes durable components",
            array(page["items"], "components").length > 0 &&
              object(page["cache"], "SBOM cache")["state"] === "fresh",
          ),
        ];
      },
    },
    {
      ...metadata(5),
      action: async ({ artifacts }) => {
        const template = runtime.versions.values().next().value;
        if (!template) throw new Error("Platform seed has no version template");
        runtime.versions.set(runtime.fs193Version, {
          ...template,
          id: runtime.fs193Version,
        });
        runtime.findings.set("fs193-valid-a", {
          id: "fs193-valid-a",
          projectVersionId: runtime.fs193Version,
          findingId: "CVE-2026-19300",
          component: {
            id: "fs193-component-a",
            name: "library-a",
            version: "1",
          },
        });
        runtime.findings.set("fs193-valid-b", {
          id: "fs193-valid-b",
          projectVersionId: runtime.fs193Version,
          findingId: "CVE-2026-19301",
          component: {
            id: "fs193-component-b",
            name: "library-b",
            version: "1",
          },
        });
        const pull = () =>
          runtime.host.harness.behavior.callRpc("syncPull", {
            workspaceProjectId: WORKSPACE_PROJECT_ID,
            projectId: runtime.projectId,
            projectVersionId: runtime.fs193Version,
            kinds: ["finding"],
          });
        await pull();
        for (const id of ["fs193-valid-a", "fs193-valid-b"])
          runtime.findings.delete(id);
        for (let index = 1; index <= 3; index += 1) {
          runtime.findings.set(`fs193-bad-${index}`, {
            id: `fs193-bad-${index}`,
            projectVersionId: runtime.fs193Version,
            findingId: `CVE-2026-1931${index}`,
            component: { id: `fs193-invalid-${index}`, version: "" },
          });
        }
        let failure = "";
        try {
          await pull();
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }
        const retained = await runtime.host.harness.behavior.callRpc(
          "findingsUiList",
          {
            projectId: runtime.projectId,
            projectVersionId: runtime.fs193Version,
            pageSize: 100,
            continuation: null,
            filters: {},
          },
        );
        for (let index = 1; index <= 3; index += 1)
          runtime.findings.delete(`fs193-bad-${index}`);
        runtime.findings.set("fs193-repaired", {
          id: "fs193-repaired",
          projectVersionId: runtime.fs193Version,
          findingId: "CVE-2026-19320",
          component: {
            id: "fs193-repaired-component",
            name: "repaired-library",
            version: "2",
          },
        });
        const recovered = await pull();
        const published = await runtime.host.harness.behavior.callRpc(
          "findingsUiList",
          {
            projectId: runtime.projectId,
            projectVersionId: runtime.fs193Version,
            pageSize: 100,
            continuation: null,
            filters: {},
          },
        );
        runtime.evidence.set("fs193", {
          failure,
          retained,
          recovered,
          published,
        });
        await artifacts.writeJson("quarantine-recovery.json", {
          failure,
          retained,
          recovered,
          published,
        });
      },
      assert: async () => {
        const evidence = object(
          runtime.evidence.get("fs193"),
          "FS-193 evidence",
        );
        const retained = array(
          object(evidence["retained"], "retained page")["items"],
          "retained rows",
        );
        const published = array(
          object(evidence["published"], "published page")["items"],
          "published rows",
        );
        return [
          assertion(
            "all-quarantined pull fails with truthful count",
            string(evidence["failure"], "failure").includes(
              "quarantined 3 fetched finding rows",
            ),
          ),
          assertion(
            "accepted generation remains visible",
            retained.length === 2,
          ),
          assertion(
            "same-kind repaired pull publishes",
            published.length === 1,
          ),
        ];
      },
    },
    {
      ...metadata(6),
      action: async ({ artifacts }) => {
        const page = await triageTargets(runtime, ["golden-finding-3"]);
        const target = array(page["items"], "single targets")[0];
        const prior = object(target, "single target")["prior"];
        const written = object(
          await runtime.host.harness.behavior.callRpc("triageDecisionsWrite", {
            workspaceProjectId: WORKSPACE_PROJECT_ID,
            platformProjectId: runtime.projectId,
            projectVersionId: runtime.findingVersion,
            decisions: [
              decision(target, "Golden Loop single reviewed rationale"),
            ],
          }),
          "single write",
        );
        const success = object(
          array(written["results"], "single results")[0],
          "single result",
        );
        const undone = await runtime.host.harness.behavior.callRpc(
          "triageDecisionUndo",
          {
            workspaceProjectId: WORKSPACE_PROJECT_ID,
            platformProjectId: runtime.projectId,
            projectVersionId: runtime.findingVersion,
            findingId: success["findingId"],
            stableKey: success["stableKey"],
            token: success["undo"],
          },
        );
        const reread = await triageTargets(runtime, ["golden-finding-3"]);
        runtime.evidence.set("fs194", { prior, written, undone, reread });
        await artifacts.writeJson("single-write-undo.json", {
          prior,
          written,
          undone,
          reread,
        });
      },
      assert: async () => {
        const evidence = object(
          runtime.evidence.get("fs194"),
          "FS-194 evidence",
        );
        const result = object(
          array(object(evidence["written"], "write")["results"], "results")[0],
          "result",
        );
        const reread = object(
          array(object(evidence["reread"], "reread")["items"], "items")[0],
          "target",
        );
        return [
          assertion("single YAML write completes", result["success"] === true),
          assertion(
            "undo reverts the claimed decision",
            JSON.stringify(reread["prior"]) ===
              JSON.stringify(evidence["prior"]),
          ),
        ];
      },
    },
    {
      ...metadata(7),
      action: async ({ artifacts }) => {
        const candidates = object(
          await runtime.host.harness.behavior.callRpc(
            "syncAsProjectCandidates",
            {
              workspaceProjectId: WORKSPACE_PROJECT_ID,
              projectId: runtime.projectId,
              projectVersionId: null,
            },
          ),
          "Assurance Studio project candidates",
        );
        const candidate = object(
          array(candidates["items"], "AS project candidates")[0],
          "AS project candidate",
        );
        await runtime.host.harness.behavior.callRpc("syncAsProjectSelect", {
          workspaceProjectId: WORKSPACE_PROJECT_ID,
          projectId: runtime.projectId,
          projectVersionId: null,
          assuranceStudioProjectId: string(
            candidate["assuranceStudioProjectId"],
            "AS project id",
          ),
        });
        const pull = await runtime.host.harness.behavior.runCli(
          [
            "finite-state",
            "pull",
            "requirement",
            "--project",
            runtime.projectId,
            "--version",
            runtime.findingVersion,
            "--json",
          ],
          cliContext(),
        );
        if (!successfulCli(pull))
          throw new Error(String(object(pull, "requirement pull")["stderr"]));
        await ensureFirmware(runtime, runtime.findingVersion);
        const versions = await runtime.host.harness.behavior.callRpc(
          "benchProjectVersions",
          {
            projectId: WORKSPACE_PROJECT_ID,
          },
        );
        const selected = object(versions, "bench versions")[
          "selectedProjectVersionId"
        ];
        if (selected !== runtime.findingVersion)
          throw new Error(
            "FS-201 pull succeeded but its version is absent from the bench selector",
          );
        const attempt = object(
          await runtime.host.harness.behavior.callRpc("benchRunAttemptStart", {
            projectId: runtime.projectId,
            projectVersionId: selected,
            tier: "tier0",
            hostId: "golden-host",
          }),
          "bench run attempt",
        );
        if (attempt["success"] !== true) {
          throw new Error(
            `FS-201 pull reached bench but run failed: ${String(attempt["message"])}`,
          );
        }
        const runs = await runtime.host.harness.behavior.callRpc(
          "benchRunsList",
          {
            projectId: runtime.projectId,
            projectVersionId: selected,
            pageSize: 20,
            continuation: null,
          },
        );
        const slot = renderSlot(
          await registeredPanel("bench"),
          { subPath: "" },
          panelRuntime(runtime),
        );
        await slot.findByLabelText(/OTA verdict:/u);
        await artifacts.writeJson("fs201-completed.json", {
          pull,
          versions,
          attempt,
          runs,
        });
        await artifacts.writeText(
          "fs201-bench.dom.html",
          slot.container.innerHTML,
        );
        slot.unmount();
      },
      assert: async () => {
        const versions = object(
          await runtime.host.harness.behavior.callRpc("benchProjectVersions", {
            projectId: WORKSPACE_PROJECT_ID,
          }),
          "bench versions",
        );
        const runs = object(
          await runtime.host.harness.behavior.callRpc("benchRunsList", {
            projectId: runtime.projectId,
            projectVersionId: runtime.findingVersion,
            pageSize: 20,
            continuation: null,
          }),
          "bench runs",
        );
        return [
          assertion(
            "requirement pull makes its exact version selectable",
            versions["selectedProjectVersionId"] === runtime.findingVersion,
          ),
          assertion(
            "requirement-to-bench journey creates durable run evidence",
            number(runs["total"], "bench run total") > 0,
          ),
        ];
      },
    },
    {
      ...metadata(8),
      action: async ({ artifacts }) => {
        await ensureSbomPull(runtime);
        const page = await runtime.host.harness.behavior.callRpc(
          "bomSoftwareList",
          {
            projectId: runtime.projectId,
            projectVersionId: runtime.bomVersion,
            pageSize: 100,
            continuation: null,
            filters: {},
          },
        );
        runtime.evidence.set("bom-page", page);
        await artifacts.writeJson("bom-page.json", page);
      },
      assert: async () => [
        assertion(
          "BOM inventory reads durable rows",
          array(
            object(runtime.evidence.get("bom-page"), "BOM page")["items"],
            "items",
          ).length > 0,
        ),
      ],
    },
    {
      ...metadata(9),
      action: async ({ artifacts }) => {
        const { architectureEntityPayload, parseArchitectureEntity } =
          await import("../../../lanes/product-security/canvas/editing/schema.js");
        const fields = architectureEntityPayload(
          parseArchitectureEntity("component", {
            slug: "golden-gateway",
            name: "Golden gateway",
            component_type: "software",
            criticality: "high",
            interfaces: [],
            technologies: ["typescript"],
            is_entry_point: true,
            stores_data: false,
          }),
        );
        const written = await runtime.host.harness.behavior.callRpc(
          "taraCommandApply",
          {
            projectId: WORKSPACE_PROJECT_ID,
            projectVersionId: null,
            operation: "create",
            kind: "component",
            fields,
            expectedContentSha256: null,
          },
        );
        const page = await runtime.host.harness.behavior.callRpc("taraList", {
          projectId: WORKSPACE_PROJECT_ID,
          projectVersionId: null,
          kind: "component",
          filters: {},
          pageSize: 50,
          continuation: null,
        });
        runtime.evidence.set("canvas", { written, page });
        await artifacts.writeJson("canvas-rpc.json", { written, page });
      },
      assert: async ({ worktree }) => {
        const written = object(
          object(runtime.evidence.get("canvas"), "canvas evidence")["written"],
          "canvas write",
        );
        return [
          assertion(
            "canvas RPC reads authored component",
            array(
              object(
                object(runtime.evidence.get("canvas"), "canvas")["page"],
                "page",
              )["items"],
              "items",
            ).some(
              (item) => object(item, "canvas row")["key"] === "golden-gateway",
            ),
          ),
          await fileAssertion(
            worktree,
            "product-security/architecture/components/golden-gateway.yaml",
            "slug: golden-gateway",
          ),
          assertion(
            "canvas write returns review diff",
            typeof written["diffSummary"] === "string",
          ),
        ];
      },
    },
    {
      ...metadata(10),
      action: async ({ artifacts }) => {
        await ensureFindingPull(runtime);
        const before = runtime.host.harness.inspection.realtimeSignals.length;
        await runtime.host.harness.behavior.callRpc("syncPull", {
          workspaceProjectId: WORKSPACE_PROJECT_ID,
          projectId: runtime.projectId,
          projectVersionId: runtime.findingVersion,
          kinds: ["finding"],
        });
        const signals =
          runtime.host.harness.inspection.realtimeSignals.slice(before);
        const durable = await runtime.host.harness.behavior.callRpc(
          "findingsUiList",
          {
            projectId: runtime.projectId,
            projectVersionId: runtime.findingVersion,
            pageSize: 100,
            continuation: null,
            filters: {},
          },
        );
        runtime.evidence.set("realtime", { signals, durable });
        await artifacts.writeJson("realtime-refetch.json", {
          signals,
          durable,
        });
      },
      assert: async () => {
        const evidence = object(
          runtime.evidence.get("realtime"),
          "realtime evidence",
        );
        return [
          assertion(
            "publication emits refetch hint",
            array(evidence["signals"], "signals").some(
              (signal) =>
                object(signal, "signal")["channel"] === "findings:changed",
            ),
          ),
          assertion(
            "assertion refetches durable state",
            array(object(evidence["durable"], "durable page")["items"], "rows")
              .length === 3,
          ),
        ];
      },
    },
    {
      ...metadata(11),
      expectedFailure: {
        task: "FS-201",
        reason: "the production Bench bootstrap path has not landed",
        signature: "No puller is registered for verificationRun",
      },
      setup: async () => ensureBenchReady(runtime),
      action: async ({ artifacts }) => {
        const digest = await mountedFirmwareDigest(runtime, BENCH_VERSION);
        const runs = await runtime.host.harness.behavior.callRpc(
          "benchRunsList",
          {
            projectId: runtime.projectId,
            projectVersionId: BENCH_VERSION,
            pageSize: 20,
            continuation: null,
          },
        );
        const verdict = await runtime.host.harness.behavior.callRpc(
          "benchOtaVerdictGet",
          {
            projectId: runtime.projectId,
            pvId: BENCH_VERSION,
            digest,
          },
        );
        await artifacts.writeJson("run-evidence.json", { runs, verdict });
      },
      assert: async () => {
        const runs = object(
          await runtime.host.harness.behavior.callRpc("benchRunsList", {
            projectId: runtime.projectId,
            projectVersionId: BENCH_VERSION,
            pageSize: 20,
            continuation: null,
          }),
          "bench runs",
        );
        const verdict = object(
          await runtime.host.harness.behavior.callRpc("benchOtaVerdictGet", {
            projectId: runtime.projectId,
            pvId: BENCH_VERSION,
            digest: await mountedFirmwareDigest(runtime, BENCH_VERSION),
          }),
          "bench verdict",
        );
        return [
          assertion(
            "failed dispatch evidence remains durably queryable",
            number(runs["total"], "run total") > 0 &&
              array(runs["items"], "run rows")
                .map((item) => object(item, "run row"))
                .some(
                  (row) =>
                    object(row["fields"], "run fields")["status"] === "failed",
                ),
          ),
          assertion(
            "verdict is explicit",
            ["INCONCLUSIVE", "SAFE_TO_OTA", "NOT_SAFE"].includes(
              string(verdict["verdict"], "verdict state"),
            ),
          ),
        ];
      },
    },
    {
      ...metadata(12),
      expectedFailure: {
        task: "FS-201",
        reason: "the production Bench bootstrap path has not landed",
        signature: "No puller is registered for verificationRun",
      },
      setup: async () => ensureBenchReady(runtime),
      action: async ({ artifacts }) => {
        const slot = renderSlot(
          await registeredPanel("bench"),
          { subPath: "" },
          panelRuntime(runtime),
        );
        await slot.findByLabelText(/OTA verdict:/u);
        await artifacts.writeText(
          "demo-card.dom.html",
          slot.container.innerHTML,
        );
        slot.unmount();
      },
      assert: async () => {
        const verdict = object(
          await runtime.host.harness.behavior.callRpc("benchOtaVerdictGet", {
            projectId: runtime.projectId,
            pvId: BENCH_VERSION,
            digest: await mountedFirmwareDigest(runtime, BENCH_VERSION),
          }),
          "bench verdict",
        );
        return [
          assertion(
            "registered Bench panel reads a current durable verdict",
            verdict["currentMountedDigest"] === verdict["firmwareDigest"] &&
              verdict["stale"] === false,
          ),
        ];
      },
    },
    {
      ...metadata(13),
      action: async ({ git, worktree, artifacts }) => {
        await writeFile(
          join(worktree, "golden-loop-change.txt"),
          "reviewable change\n",
          "utf8",
        );
        await git.run(["add", "golden-loop-change.txt"]);
        await git.run(["commit", "-m", "Golden Loop reviewable change"]);
        const show = await git.run(["show", "--stat", "--oneline", "HEAD"]);
        runtime.evidence.set("git-show", show.stdout);
        await artifacts.writeText("git-commit.txt", show.stdout);
      },
      assert: async () => [
        assertion(
          "deterministic commit is reviewable",
          string(runtime.evidence.get("git-show"), "git show").includes(
            "Golden Loop reviewable change",
          ),
        ),
      ],
    },
    {
      ...metadata(14),
      action: async ({ artifacts }) => {
        await human(runtime).reviewDiff({ beat: 14, source: "git diff" });
        let refusal = "";
        try {
          await runtime.host.harness.behavior.callAgentTool("human.push", {});
        } catch (error) {
          refusal = error instanceof Error ? error.message : String(error);
        }
        await human(runtime).push({
          beat: 14,
          destination: "local rehearsal remote",
        });
        runtime.evidence.set("human-boundary", refusal);
        await artifacts.writeJson("human-boundary.json", {
          agentRefusal: refusal,
          humanActions: ["reviewDiff", "push"],
        });
      },
      assert: async () => [
        assertion(
          "agent cannot invoke human push",
          string(runtime.evidence.get("human-boundary"), "agent refusal")
            .length > 0,
        ),
        assertion(
          "human tools are absent from registry",
          !runtime.host.harness.inspection.registrations.agentTools.some(
            ({ name }) => name.startsWith("human."),
          ),
        ),
      ],
    },
  ];
  return list;
}

async function createRun(
  runLabel: "run-1" | "run-2",
): Promise<Readonly<{ harness: GoldenLoopHarness; runtime: Runtime }>> {
  vi.resetModules();
  installTestPluginRuntime();
  let worktree = "";
  let runtime: Runtime | undefined;
  const harness = await createGoldenLoopHarness({
    repositoryRoot: REPOSITORY_ROOT,
    ...(process.env["GOLDEN_LOOP_EVIDENCE_DIR"]
      ? {
          evidenceDirectory: join(
            process.env["GOLDEN_LOOP_EVIDENCE_DIR"],
            runLabel,
          ),
        }
      : {}),
    scenario: beats(
      new Proxy({} as Runtime, {
        get(_target, property) {
          if (!runtime)
            throw new Error(
              `Golden Loop runtime unavailable for ${String(property)}`,
            );
          return Reflect.get(runtime, property);
        },
        set(_target, property, value) {
          if (!runtime)
            throw new Error(
              `Golden Loop runtime unavailable for ${String(property)}`,
            );
          return Reflect.set(runtime, property, value);
        },
      }),
    ),
    host: {
      sdk: {
        projects: {
          get: ({ projectId }) => ({
            id: projectId,
            kind: "standard" as const,
            name: "Golden Loop",
            gitRemoteUrl: null,
            createdAt: 1,
            updatedAt: 1,
            sources: [
              {
                id: "golden-source",
                projectId,
                type: "local_path" as const,
                hostId: "golden-host",
                path: worktree,
                isDefault: true,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }),
        },
        threads: {
          get: async ({ threadId }) => ({
            id: threadId,
            projectId:
              threadId === "thread-firmware-golden"
                ? (runtime?.projectId ?? WORKSPACE_PROJECT_ID)
                : WORKSPACE_PROJECT_ID,
            environmentId:
              threadId === "thread-firmware-golden"
                ? "environment-firmware-golden"
                : "environment-golden-loop",
            title: "Golden Loop",
            status: "active" as const,
            agentStatus: null,
            archived: false,
            preview: "",
            createdAt: 1,
            updatedAt: 1,
            unread: false,
            provider: null,
            model: null,
            reasoningEffort: null,
            serviceTier: null,
            permissionMode: null,
            interactionMode: null,
            parentThreadId: null,
            source: null,
            headSha: null,
            branch: null,
            worktreePath: worktree,
            error: null,
            labels: [],
            attachments: [],
          }),
          spawn: async () => {
            if (runtime?.failNextThreadSpawn) {
              runtime.failNextThreadSpawn = false;
              throw new Error("induced registered bench dispatch failure");
            }
            return { id: "thread-bench-golden" };
          },
        },
        environments: {
          get: async ({ environmentId }) => ({
            id: environmentId,
            projectId:
              environmentId === "environment-firmware-golden"
                ? (runtime?.projectId ?? WORKSPACE_PROJECT_ID)
                : WORKSPACE_PROJECT_ID,
            path: worktree,
            hostId: "golden-host",
          }),
        },
        hosts: {
          list: async () => [
            {
              id: "golden-host",
              name: "Golden host",
              type: "persistent" as const,
              status: "connected" as const,
              maxPermissionMode: "full" as const,
              lastSeenAt: 1,
              lastRejectedProtocolVersion: null,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
        files: {
          async list({ path }) {
            const entries = await readdir(path, { withFileTypes: true }).catch(
              () => [],
            );
            return {
              files: entries
                .filter((entry) => entry.isFile())
                .map((entry) => ({
                  path: join(path, entry.name),
                  name: entry.name,
                })),
              truncated: false,
            };
          },
          async read({ path }) {
            const content = await readFile(path, "utf8");
            return {
              content,
              contentEncoding: "utf8" as const,
              sha256: sha256(content),
            };
          },
          async write({ path, content, expectedSha256 }) {
            const existing = await readFile(path, "utf8").catch(() => null);
            const currentSha256 = existing === null ? null : sha256(existing);
            if (currentSha256 !== expectedSha256)
              return { outcome: "conflict" as const, currentSha256 };
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, content, "utf8");
            return {
              outcome: "written" as const,
              sha256: sha256(content),
              sizeBytes: Buffer.byteLength(content),
            };
          },
        },
      },
    },
    configure: async ({ bb, host, worktree: configuredWorktree }) => {
      worktree = configuredWorktree;
      const gitignorePath = join(worktree, ".gitignore");
      const gitignore = await readFile(gitignorePath, "utf8").catch(() => "");
      if (!gitignore.split("\n").includes(".fs-firmware/")) {
        await writeFile(
          gitignorePath,
          `${gitignore}${gitignore.endsWith("\n") || gitignore.length === 0 ? "" : "\n"}.fs-firmware/\n`,
          "utf8",
        );
      }
      const [
        contextModule,
        platformClientModule,
        asClientModule,
        mockModule,
        platformStateModule,
        platformRegisterModule,
        platformFirmwareModule,
        asRegisterModule,
        syncModule,
        pushModule,
        findingsModule,
        bomModule,
        benchModule,
        firmwareModule,
        productModule,
        actionsModule,
      ] = await Promise.all([
        import("../../../lib/context.js"),
        import("../../../lib/remote/platform/client.js"),
        import("../../../lib/remote/assurance-studio/client.js"),
        import("../../mock-remote/server.js"),
        import("../../mock-remote/platform/state.js"),
        import("../../mock-remote/platform/register.js"),
        import("../../mock-remote/platform/firmware.js"),
        import("../../mock-remote/assurance-studio/register.js"),
        import("../../../lanes/sync/register.js"),
        import("../../../lanes/sync/push/index.js"),
        import("../../../lanes/findings/register.js"),
        import("../../../lanes/bom/register.js"),
        import("../../../lanes/bench/register.js"),
        import("../../../lanes/firmware/register.js"),
        import("../../../lanes/product-security/register.js"),
        import("../../../lanes/agentic/tools/actions.js"),
      ]);
      const state = platformStateModule.createMockPlatformState(FIXTURE_ROOT);
      const templateVersion =
        [...state.versions.values()].find(
          (version) => version["priorVersionId"] !== null,
        ) ?? state.versions.values().next().value;
      const templateProject = state.projects.values().next().value;
      if (!templateVersion || !templateProject)
        throw new Error("Mock Platform seed is empty");
      const projectId = string(templateProject["id"], "Platform project id");
      const bomVersion = string(templateVersion["id"], "Platform version id");
      const findingVersion = BENCH_VERSION;
      const fs167Version = "golden-fs167-version";
      state.versions.set(findingVersion, {
        ...templateVersion,
        id: findingVersion,
      });
      state.versions.set(fs167Version, {
        ...templateVersion,
        id: fs167Version,
        priorVersionId: null,
      });
      state.findings.clear();
      for (let index = 1; index <= 3; index += 1) {
        state.findings.set(`golden-finding-${index}`, {
          id: `golden-finding-${index}`,
          projectVersionId: findingVersion,
          findingId: `CVE-2026-6500${index}`,
          component: {
            id: `golden-component-${index}`,
            name: `golden-component-${index}`,
            version: "1.0.0",
          },
          severity: index === 1 ? "critical" : "high",
          reachability: {
            verdict: "unreachable",
            factors: [
              { label: "Call graph", value: "no path", source: "analysis" },
            ],
          },
        });
      }
      for (let index = 1; index <= 201; index += 1) {
        const findingId = fs167FindingId(index);
        const cve = `CVE-2026-${String(167000 + index)}`;
        const componentName = `fs167-component-${index}`;
        state.findings.set(findingId, {
          id: findingId,
          projectVersionId: fs167Version,
          findingId: cve,
          cve,
          componentName,
          componentGroup: null,
          componentVersion: "1.0.0",
          component: {
            id: `fs167-component-${index}`,
            name: componentName,
            version: "1.0.0",
          },
          severity: "medium",
          reachability: {
            verdict: "unreachable",
            factors: [
              { label: "Call graph", value: "no path", source: "analysis" },
            ],
          },
          vexStatus: "IN_TRIAGE",
          vexJustification: null,
          vexResponse: null,
          vexReason: null,
        });
      }
      const remote = mockModule.createMockRemote({
        platformToken: "golden-platform-token",
        assuranceStudioKey: "golden-as-key",
        fixtureRoot: FIXTURE_ROOT,
        register(service, registry) {
          if (service === "platform") {
            platformRegisterModule.registerPlatformHandlers(registry, state);
            platformFirmwareModule.registerMockPlatformFirmware(
              registry,
              FIXTURE_ROOT,
            );
          } else
            asRegisterModule.registerMockAssuranceStudio(
              registry,
              FIXTURE_ROOT,
              { now: () => "2026-08-14T12:00:00.000Z" },
            );
        },
      });
      const platform = new platformClientModule.PlatformClient({
        baseUrl: "http://platform.mock",
        token: "golden-platform-token",
        async fetch(input, init) {
          const url = new URL(
            input instanceof Request ? input.url : input.toString(),
          );
          if (runtime?.failSbom && url.pathname.includes("/components")) {
            return Response.json(
              { message: "induced recoverable SBOM failure" },
              { status: 422 },
            );
          }
          return remote.platform.fetch(input, init);
        },
      });
      const assuranceStudio = new asClientModule.AssuranceStudioClient({
        baseUrl: "http://assurance-studio.mock",
        apiKey: "golden-as-key",
        fetch: remote.assuranceStudio.fetch,
      });
      const ctx = contextModule.createPluginContext(bb);
      ctx.service("remote-services", () => ({
        platform,
        assuranceStudio,
        forgeCompute: null,
      }));
      benchModule.registerBench(bb, ctx);
      firmwareModule.registerFirmware(bb, ctx);
      const wrapperPath = join(worktree, "golden-unpack-wrapper.mjs");
      await writeFile(wrapperPath, FAKE_UNPACK_WRAPPER, "utf8");
      firmwareModule.configureStandaloneUnpackRuntime(ctx, {
        wrapper: {
          executablePath: process.execPath,
          argvPrefix: [wrapperPath],
          factImage: "finite-state/golden-loop:test",
          timeoutMs: 5_000,
        },
      });
      host.harness.runService("firmware-materialization");
      syncModule.registerSync(bb, ctx);
      findingsModule.registerFindings(bb, ctx);
      productModule.registerProductSecurity(bb, ctx);
      bomModule.registerBom(bb, ctx);
      actionsModule.registerActionTools(bb, ctx);
      bb.onDispose(async () => {
        platform.close();
        assuranceStudio.close();
        await remote.close();
      });
      runtime = {
        host,
        worktree,
        projectId,
        findingVersion,
        fs167Version,
        bomVersion,
        fs193Version: "golden-fs193-version",
        findings: state.findings,
        versions: state.versions,
        evidence: new Map(),
        failSbom: false,
        failNextTriageWrite: false,
        failNextThreadSpawn: false,
        firmwareReady: new Set(),
        benchReady: false,
        panelRpcCalls: [],
        fs167ReviewPlanCalls: 0,
        panelPlan: null,
        humanPushApproved: false,
        executeHumanPush: async (input) => {
          const request = object(input, "human push input");
          return pushModule.push(
            {
              db: ctx.db(),
              worktreeRoot: worktree,
              now: () => new Date("2026-08-14T12:00:00.000Z"),
              createRunId: () => "golden-loop-human-push",
            },
            {
              scope: {
                projectId: string(request["projectId"], "push project"),
                projectVersionId: string(
                  request["projectVersionId"],
                  "push version",
                ),
              },
              planId: string(request["planId"], "push plan id"),
              expectedPlanSha256: string(
                request["expectedPlanSha256"],
                "push plan sha",
              ),
              expectedBaseStateSha256: string(
                request["expectedBaseStateSha256"],
                "push base state sha",
              ),
              confirmed: true,
              pageSize: number(request["pageSize"], "push page size"),
              continuation: null,
            },
          );
        },
        refreshOverlayIndex: async () => {
          await ctx
            .service<{ rebuild(root: string): Promise<void> }>(
              "findings.overlay",
              () => {
                throw new Error("Findings overlay owner is unavailable");
              },
            )
            .rebuild(worktree);
        },
        human: null,
      };
    },
    human: {
      reviewDiff: async () => {},
      resolveConflict: async () => {},
      push: async () => {
        if (!runtime) throw new Error("Golden Loop runtime is unavailable");
        runtime.humanPushApproved = true;
      },
    },
  });
  if (!runtime)
    throw new Error("Golden Loop configure did not initialize runtime");
  runtime.human = harness.human;
  return { harness, runtime };
}

afterEach(() => cleanup());

describe.sequential("Golden Loop incremental acceptance", () => {
  it(
    "runs all fourteen ordered beats twice with the same semantic result",
    async () => {
      const first = await createRun("run-1");
      try {
        const firstResults = await first.harness.runAll();
        expect(firstResults).toHaveLength(14);
        expect(firstResults.map(({ beat }) => beat)).toEqual(
          GOLDEN_LOOP_BEATS.map(({ number }) => number),
        );
        const pendingBeats = new Set([3, 11, 12]);
        expect(
          firstResults
            .filter(({ status }) => status === "skipped")
            .map(({ beat }) => beat),
        ).toEqual([...pendingBeats]);
        const unexpected = firstResults.filter(({ beat, status }) =>
          pendingBeats.has(beat) ? status !== "skipped" : status !== "passed",
        );
        expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([]);
        first.harness.assertNoExternalNetwork();
        const firstSemantic = semanticReport(first.harness.report!);

        const second = await createRun("run-2");
        try {
          const secondResults = await second.harness.runAll();
          expect(secondResults).toHaveLength(14);
          second.harness.assertNoExternalNetwork();
          expect(semanticReport(second.harness.report!)).toEqual(firstSemantic);
          expect(second.harness.report?.durationMs).toBeLessThan(
            15 * 60 * 1_000,
          );
        } finally {
          await second.harness.dispose();
        }
      } finally {
        await first.harness.dispose();
      }
    },
    15 * 60 * 1_000,
  );

  it("rejects missing or duplicated beat modules before creating a run", async () => {
    const complete = new Map(
      GOLDEN_LOOP_BEATS.map((beat) => [beat.number, beat]),
    );
    expect(complete.size).toBe(14);
    expect(GOLDEN_LOOP_BEATS.map(({ number }) => number)).toEqual([
      ...complete.keys(),
    ]);
  });
});

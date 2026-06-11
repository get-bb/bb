import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { createApiClient, type ApiClient } from "@bb/server-contract";
import type { WorkflowRunResponse } from "@bb/server-contract";

// Same harness as command-output.test.ts: stub the server at the hono-client
// level while every read still runs through the production transport (error
// mapping included). Raw routes (`wait`) must resolve real `Response`
// objects — they go through the untouched `transport.resolve`.
const serverClientState = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("../client.js", async () => {
  const { createBbSdk } =
    await vi.importActual<typeof import("@bb/sdk/core")>("@bb/sdk/core");
  const { createHttpTransport } =
    await vi.importActual<typeof import("@bb/sdk/node")>("@bb/sdk/node");
  const toResponse = (resolved: MockTransportResolved): Response =>
    resolved instanceof Response
      ? resolved
      : new Response(JSON.stringify(resolved), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
  const createCliBbSdk = vi.fn((baseUrl: string) => {
    const realTransport = createHttpTransport({ baseUrl, runtime: "node" });
    return createBbSdk({
      transport: {
        ...realTransport,
        api: serverClientState.createClient(baseUrl)?.api ?? {},
        readJson: (responsePromise: MockTransportPromise) =>
          realTransport.readJson(responsePromise.then(toResponse)),
        readVoid: (responsePromise: MockTransportPromise) =>
          realTransport.readVoid(responsePromise.then(toResponse)),
      },
    });
  });
  return { createCliBbSdk };
});

vi.mock("../daemon.js", () => ({
  fetchLocalHostId: vi.fn(async () => "host-test-001"),
}));

import { fetchLocalHostId } from "../daemon.js";
import { registerWorkflowCommands } from "../commands/workflow/index.js";

type MockTransportResolved =
  | Response
  | object
  | string
  | number
  | boolean
  | null;
type MockTransportPromise = Promise<MockTransportResolved>;
type ConsoleLogArgs = Parameters<typeof console.log>;

interface ServerClientOverride {
  api: object;
}

function asServerClient(value: ServerClientOverride): ApiClient {
  return Object.assign(createApiClient("http://server"), value);
}

function collectLogLines(): string[] {
  return vi
    .mocked(console.log)
    .mock.calls.map((args: ConsoleLogArgs) => args.join(" "));
}

function collectErrorLines(): string[] {
  return vi
    .mocked(console.error)
    .mock.calls.map((args: ConsoleLogArgs) => args.join(" "));
}

async function runWorkflowCommand(args: string[]): Promise<void> {
  const program = new Command();
  registerWorkflowCommands(program, () => "http://server");
  await program.parseAsync(["node", "bb", "workflow", ...args]);
}

function makeWorkflowRun(
  overrides: Partial<WorkflowRunResponse> & { id: string },
): WorkflowRunResponse {
  return {
    projectId: "proj_test",
    hostId: "host-test-001",
    workspacePath: "/tmp/checkout",
    anchorThreadId: null,
    workflowName: "deep-research",
    sourceTier: "project",
    scriptHash: "hash",
    argsJson: null,
    seed: 7,
    keyVersion: "bb1",
    providerId: "codex",
    model: null,
    effort: "medium",
    sandbox: "workspace-write",
    concurrency: 4,
    maxAgents: 24,
    maxFanout: 12,
    budgetOutputTokens: null,
    status: "running",
    failureReason: null,
    progressSnapshot: null,
    usage: { inputTokens: 0, outputTokens: 0, toolUses: 0, durationMs: 0 },
    resultJson: null,
    retention: "live",
    createdAt: 1_700_000_000_000,
    startedAt: null,
    settledAt: null,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

const VALID_WORKFLOW_SOURCE = `export const meta = {
  name: "lint-check",
  description: "A valid workflow",
};
const out = await agent("do the thing");
log(out.text);
`;

/** Every CLI launch mints a per-invocation idempotency key (crash-retry convergence). */
const CLIENT_REQUEST_ID = expect.stringMatching(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
);

describe("bb workflow commands", () => {
  const createClientMock = serverClientState.createClient;
  const fetchLocalHostIdMock = vi.mocked(fetchLocalHostId);

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(
      (code?: string | number | null) => {
        throw new Error(`process.exit:${code ?? 0}`);
      },
    );
    createClientMock.mockReset();
    fetchLocalHostIdMock.mockClear();
    fetchLocalHostIdMock.mockResolvedValue("host-test-001");
    vi.stubEnv("BB_PROJECT_ID", undefined);
    vi.stubEnv("BB_THREAD_ID", undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("workflow run launches a named workflow anchored to BB_THREAD_ID", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj_test");
    vi.stubEnv("BB_THREAD_ID", "thr_anchor");
    const created = makeWorkflowRun({ id: "wfr_new", status: "created" });
    const postMock = vi.fn(async () => created);
    createClientMock.mockReturnValue(
      asServerClient({
        api: { v1: { "workflow-runs": { $post: postMock } } },
      }),
    );

    await runWorkflowCommand([
      "run",
      "deep-research",
      "--args",
      '{"topic":"sqlite"}',
    ]);

    // Anchored launches send no hostId: the server inherits the anchor
    // thread environment's {hostId, workspacePath} — one default, owned
    // server-side, never two competing CLI/server defaults.
    expect(postMock).toHaveBeenCalledWith({
      json: {
        projectId: "proj_test",
        source: { type: "named", name: "deep-research" },
        clientRequestId: CLIENT_REQUEST_ID,
        anchorThreadId: "thr_anchor",
        args: { topic: "sqlite" },
      },
    });
    expect(fetchLocalHostIdMock).not.toHaveBeenCalled();
    const output = collectLogLines().join("\n");
    expect(output).toContain("Workflow run started: wfr_new");
    expect(output).toContain("http://server/workflows/runs/wfr_new");
    // Detached launch: the re-attach hint accompanies the live link.
    expect(output).toContain("Re-attach: bb workflow wait wfr_new");
    // Env-derived anchoring is announced on stderr with its opt-out.
    expect(collectErrorLines().join("\n")).toContain(
      "Anchored to thread thr_anchor (from BB_THREAD_ID; --no-context-anchor-thread to detach)",
    );
  });

  it("workflow run sends an explicit --host even when anchored", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj_test");
    vi.stubEnv("BB_THREAD_ID", "thr_anchor");
    const created = makeWorkflowRun({ id: "wfr_hosted", status: "created" });
    const postMock = vi.fn(async () => created);
    createClientMock.mockReturnValue(
      asServerClient({
        api: { v1: { "workflow-runs": { $post: postMock } } },
      }),
    );

    await runWorkflowCommand([
      "run",
      "deep-research",
      "--host",
      "host-explicit",
    ]);

    // Explicit --host wins over the anchored env-inheritance default.
    expect(postMock).toHaveBeenCalledWith({
      json: {
        projectId: "proj_test",
        source: { type: "named", name: "deep-research" },
        hostId: "host-explicit",
        clientRequestId: CLIENT_REQUEST_ID,
        anchorThreadId: "thr_anchor",
      },
    });
    expect(fetchLocalHostIdMock).not.toHaveBeenCalled();
  });

  it("workflow run passes a validated --effort override end to end", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj_test");
    const created = makeWorkflowRun({ id: "wfr_effort", status: "created" });
    const postMock = vi.fn(async () => created);
    createClientMock.mockReturnValue(
      asServerClient({
        api: { v1: { "workflow-runs": { $post: postMock } } },
      }),
    );

    await runWorkflowCommand(["run", "deep-research", "--effort", "high"]);

    expect(postMock).toHaveBeenCalledWith({
      json: {
        projectId: "proj_test",
        source: { type: "named", name: "deep-research" },
        hostId: "host-test-001",
        clientRequestId: CLIENT_REQUEST_ID,
        effort: "high",
      },
    });
  });

  it("workflow run rejects an invalid --effort before any request", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj_test");
    const postMock = vi.fn();
    createClientMock.mockReturnValue(
      asServerClient({
        api: { v1: { "workflow-runs": { $post: postMock } } },
      }),
    );

    await expect(
      runWorkflowCommand(["run", "deep-research", "--effort", "turbo"]),
    ).rejects.toThrow("process.exit:1");

    expect(postMock).not.toHaveBeenCalled();
    expect(collectErrorLines().join("\n")).toContain(
      'Invalid --effort "turbo"',
    );
  });

  it("workflow run remaps anchored environment 409s to the --host escape hatch", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj_test");
    vi.stubEnv("BB_THREAD_ID", "thr_anchor");
    const postMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "environment_not_ready",
            message: "Environment unavailable",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
    );
    createClientMock.mockReturnValue(
      asServerClient({
        api: { v1: { "workflow-runs": { $post: postMock } } },
      }),
    );

    await expect(
      runWorkflowCommand(["run", "deep-research"]),
    ).rejects.toThrow("process.exit:1");

    const output = collectErrorLines().join("\n");
    expect(output).toContain("inherit the thread environment");
    expect(output).toContain("Pass --host <id>");
    expect(output).toContain("--no-context-anchor-thread");
  });

  it("workflow run sends inline source for file arguments and honors --no-context-anchor-thread", async () => {
    vi.stubEnv("BB_THREAD_ID", "thr_anchor");
    const dir = await mkdtemp(join(tmpdir(), "bb-workflow-test-"));
    const file = join(dir, "inline.workflow.js");
    await writeFile(file, VALID_WORKFLOW_SOURCE, "utf8");
    const created = makeWorkflowRun({
      id: "wfr_inline",
      status: "created",
      sourceTier: "inline",
    });
    const postMock = vi.fn(async () => created);
    createClientMock.mockReturnValue(
      asServerClient({
        api: { v1: { "workflow-runs": { $post: postMock } } },
      }),
    );

    await runWorkflowCommand([
      "run",
      file,
      "--project",
      "proj_test",
      "--host",
      "host-explicit",
      "--no-context-anchor-thread",
    ]);

    expect(postMock).toHaveBeenCalledWith({
      json: {
        projectId: "proj_test",
        source: { type: "inline", script: VALID_WORKFLOW_SOURCE },
        hostId: "host-explicit",
        clientRequestId: CLIENT_REQUEST_ID,
      },
    });
    expect(fetchLocalHostIdMock).not.toHaveBeenCalled();
  });

  it("workflow run pre-validates file arguments locally and never posts an invalid script", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-workflow-test-"));
    const file = join(dir, "bad.workflow.js");
    await writeFile(
      file,
      VALID_WORKFLOW_SOURCE.replace("log(out.text);", "log(Date.now());"),
      "utf8",
    );
    const postMock = vi.fn();
    createClientMock.mockReturnValue(
      asServerClient({
        api: { v1: { "workflow-runs": { $post: postMock } } },
      }),
    );

    await expect(
      runWorkflowCommand([
        "run",
        file,
        "--project",
        "proj_test",
        "--host",
        "host-explicit",
      ]),
    ).rejects.toThrow("process.exit:1");

    // The same gate the server applies at launch, with exact findings — no
    // network round-trip for a file the server would reject anyway.
    const output = collectErrorLines().join("\n");
    expect(output).toContain("violates the determinism contract");
    expect(output).toContain("Date.now() (use now() instead)");
    expect(postMock).not.toHaveBeenCalled();
  });

  it("workflow run remaps the no-source-for-host 404 to name the chosen host and --host", async () => {
    const postMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "invalid_request",
            message: "Project has no local-path source for host",
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
    );
    createClientMock.mockReturnValue(
      asServerClient({
        api: { v1: { "workflow-runs": { $post: postMock } } },
      }),
    );

    await expect(
      runWorkflowCommand(["run", "deep-research", "--project", "proj_test"]),
    ).rejects.toThrow("process.exit:1");

    const output = collectErrorLines().join("\n");
    expect(output).toContain(
      "host host-test-001 (the local daemon's host, chosen by default)",
    );
    expect(output).toContain("Pass --host <id>");
  });

  it("workflow run --wait prints the live link first and the result after settle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-workflow-test-"));
    const file = join(dir, "inline.workflow.js");
    await writeFile(file, VALID_WORKFLOW_SOURCE, "utf8");
    const created = makeWorkflowRun({
      id: "wfr_waited",
      status: "created",
      sourceTier: "inline",
    });
    const settled = makeWorkflowRun({
      id: "wfr_waited",
      status: "completed",
      sourceTier: "inline",
      startedAt: 1_700_000_001_000,
      settledAt: 1_700_000_013_000,
      resultJson: '{"result":"Response to: do the thing"}',
    });
    const postMock = vi.fn(async () => created);
    const getMock = vi.fn(async () => makeWorkflowRun({ id: "wfr_waited" }));
    const waitMock = vi.fn(
      async () =>
        new Response(JSON.stringify(settled), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    createClientMock.mockReturnValue(
      asServerClient({
        api: {
          v1: {
            "workflow-runs": {
              $post: postMock,
              ":id": { $get: getMock, wait: { $get: waitMock } },
            },
          },
        },
      }),
    );

    await runWorkflowCommand([
      "run",
      file,
      "--project",
      "proj_test",
      "--host",
      "host-explicit",
      "--wait",
      "--timeout",
      "5",
    ]);

    expect(postMock).toHaveBeenCalledWith({
      json: {
        projectId: "proj_test",
        source: { type: "inline", script: VALID_WORKFLOW_SOURCE },
        hostId: "host-explicit",
        clientRequestId: CLIENT_REQUEST_ID,
      },
    });
    expect(waitMock).toHaveBeenCalledTimes(1);
    const lines = collectLogLines();
    const output = lines.join("\n");
    expect(output).toContain("Workflow run started: wfr_waited");
    expect(output).toContain("http://server/workflows/runs/wfr_waited");
    expect(output).toContain("Workflow run wfr_waited completed in 12s.");
    expect(output).toContain('{"result":"Response to: do the thing"}');
    // Live link first, result later: detached callers can re-attach by id.
    const liveIndex = lines.findIndex((line) => line.includes("Live:"));
    const resultIndex = lines.findIndex((line) =>
      line.includes("completed in 12s."),
    );
    expect(liveIndex).toBeGreaterThanOrEqual(0);
    expect(liveIndex).toBeLessThan(resultIndex);
  });

  it("workflow run without --host fails with daemon guidance when the local daemon is unreachable", async () => {
    fetchLocalHostIdMock.mockResolvedValue(null);

    await expect(
      runWorkflowCommand(["run", "deep-research", "--project", "proj_test"]),
    ).rejects.toThrow("process.exit:1");
    expect(collectErrorLines().join("\n")).toContain(
      "Cannot reach local host daemon. Is it running?",
    );
  });

  it("workflow run --timeout without --wait is rejected", async () => {
    await expect(
      runWorkflowCommand([
        "run",
        "deep-research",
        "--project",
        "proj_test",
        "--timeout",
        "5",
      ]),
    ).rejects.toThrow("process.exit:1");
    expect(collectErrorLines().join("\n")).toContain(
      "--timeout requires --wait.",
    );
  });

  it("workflow runs renders the run table with agent progress", async () => {
    const run = makeWorkflowRun({
      id: "wfr_table",
      status: "running",
      progressSnapshot: {
        phases: [{ index: 1, title: "Research" }],
        agents: [
          {
            index: 1,
            label: "researcher",
            state: "done",
            model: "m",
            attempt: 1,
            cached: false,
            lastProgressAt: 1,
            phaseIndex: 1,
          },
          {
            index: 2,
            label: "judge",
            state: "running",
            model: "m",
            attempt: 1,
            cached: false,
            lastProgressAt: 1,
            phaseIndex: 1,
          },
        ],
      },
    });
    const getMock = vi.fn(async () => [run]);
    createClientMock.mockReturnValue(
      asServerClient({
        api: { v1: { "workflow-runs": { $get: getMock } } },
      }),
    );

    await runWorkflowCommand(["runs", "--project", "proj_test", "--limit", "5"]);

    expect(getMock).toHaveBeenCalledWith({
      query: { projectId: "proj_test", limit: "5" },
    });
    const output = collectLogLines().join("\n");
    expect(output).toContain("wfr_table");
    expect(output).toContain("deep-research");
    expect(output).toContain("1/2");
  });

  it("workflow list renders definitions across tiers", async () => {
    const getMock = vi.fn(async () => [
      { name: "deep-research", description: "Research a topic", tier: "builtin" },
      {
        name: "code-review",
        description: "Review a diff",
        whenToUse: "before merging",
        tier: "project",
      },
    ]);
    createClientMock.mockReturnValue(
      asServerClient({ api: { v1: { workflows: { $get: getMock } } } }),
    );

    await runWorkflowCommand(["list", "--project", "proj_test"]);

    expect(getMock).toHaveBeenCalledWith({
      query: { projectId: "proj_test" },
    });
    const output = collectLogLines().join("\n");
    expect(output).toContain("deep-research");
    expect(output).toContain("builtin");
    expect(output).toContain("code-review");
    expect(output).toContain("project");
  });

  it("workflow show prints the detail block and the phase/agent tree", async () => {
    const run = makeWorkflowRun({
      id: "wfr_show",
      status: "completed",
      startedAt: 1_700_000_001_000,
      settledAt: 1_700_000_063_000,
      resultJson: '{"answer":42}',
      usage: {
        inputTokens: 1000,
        outputTokens: 2000,
        toolUses: 3,
        durationMs: 62_000,
      },
      progressSnapshot: {
        phases: [
          { index: 1, title: "Research" },
          { index: 2, title: "Synthesis" },
        ],
        agents: [
          {
            index: 1,
            label: "researcher",
            state: "done",
            model: "m",
            attempt: 1,
            cached: true,
            lastProgressAt: 1,
            phaseIndex: 1,
            tokens: 1234,
            durationMs: 45_000,
          },
          {
            index: 2,
            label: "judge",
            state: "failed",
            model: "m",
            attempt: 2,
            cached: false,
            lastProgressAt: 1,
            phaseIndex: 2,
            error: "boom",
          },
        ],
      },
    });
    const getMock = vi.fn(async () => run);
    createClientMock.mockReturnValue(
      asServerClient({
        api: { v1: { "workflow-runs": { ":id": { $get: getMock } } } },
      }),
    );

    await runWorkflowCommand(["show", "wfr_show"]);

    expect(getMock).toHaveBeenCalledWith({ param: { id: "wfr_show" } });
    const output = collectLogLines().join("\n");
    expect(output).toContain("Run: wfr_show");
    expect(output).toContain("Status: completed (2/2 agents settled)");
    expect(output).toContain("Phase 1 — Research");
    expect(output).toContain("✓ 1. researcher [done, cached] 1234 tok · 45s");
    expect(output).toContain("Phase 2 — Synthesis");
    expect(output).toContain("✗ 2. judge [failed, attempt 2] — boom");
    expect(output).toContain('{"answer":42}');
  });

  it("workflow show renders interrupted runs with paused agents and terminal leftovers as stopped", async () => {
    // The SPA agent tree's display-state semantics (shared via
    // @bb/thread-view): a paused run renders running agents paused (queued
    // stays queued); a terminal run renders leftover non-settled agents as
    // stopped. The CLI tree must not print raw `running` for either.
    const progressSnapshot = {
      phases: [{ index: 1, title: "Research" }],
      agents: [
        {
          index: 1,
          label: "researcher",
          state: "running" as const,
          model: "m",
          attempt: 1,
          cached: false,
          lastProgressAt: 1,
          phaseIndex: 1,
          lastToolName: "grep",
        },
        {
          index: 2,
          label: "judge",
          state: "queued" as const,
          model: "m",
          attempt: 1,
          cached: false,
          lastProgressAt: 1,
          phaseIndex: 1,
        },
      ],
    };
    const interrupted = makeWorkflowRun({
      id: "wfr_paused",
      status: "interrupted",
      progressSnapshot,
    });
    const getMock = vi.fn(async () => interrupted);
    createClientMock.mockReturnValue(
      asServerClient({
        api: { v1: { "workflow-runs": { ":id": { $get: getMock } } } },
      }),
    );

    await runWorkflowCommand(["show", "wfr_paused"]);

    const pausedOutput = collectLogLines().join("\n");
    expect(pausedOutput).toContain("‖ 1. researcher [paused]");
    expect(pausedOutput).toContain("· 2. judge [queued]");
    // A paused agent is not mid-tool: the live-only tool gloss must not print.
    expect(pausedOutput).not.toContain("tool: grep");
    expect(pausedOutput).not.toContain("[running]");

    vi.mocked(console.log).mockClear();
    getMock.mockResolvedValue(
      makeWorkflowRun({
        id: "wfr_torn",
        status: "failed",
        failureReason: "budget exceeded",
        progressSnapshot,
      }),
    );

    await runWorkflowCommand(["show", "wfr_torn"]);

    const settledOutput = collectLogLines().join("\n");
    expect(settledOutput).toContain("▪ 1. researcher [stopped]");
    expect(settledOutput).toContain("▪ 2. judge [stopped]");
    expect(settledOutput).not.toContain("[running]");
    expect(settledOutput).not.toContain("[queued]");
  });

  it("workflow show rejects wfa_* agent session ids with guidance", async () => {
    await expect(runWorkflowCommand(["show", "wfa_agent_1"])).rejects.toThrow(
      "process.exit:1",
    );
    expect(collectErrorLines().join("\n")).toContain(
      "workflow agent session id",
    );
  });

  it("workflow wait and cancel reject wfa_* and malformed run ids before any request", async () => {
    await expect(runWorkflowCommand(["wait", "wfa_run_7"])).rejects.toThrow(
      "process.exit:1",
    );
    expect(collectErrorLines().join("\n")).toContain(
      "workflow agent session id",
    );

    vi.mocked(console.error).mockClear();
    await expect(runWorkflowCommand(["cancel", "notarunid"])).rejects.toThrow(
      "process.exit:1",
    );
    const output = collectErrorLines().join("\n");
    expect(output).toContain('Invalid workflow run ID "notarunid"');
    expect(output).toContain("wfr_*");
  });

  it("workflow wait loops through a 204 round and prints the result", async () => {
    const settled = makeWorkflowRun({
      id: "wfr_wait",
      status: "completed",
      startedAt: 1_700_000_001_000,
      settledAt: 1_700_000_031_000,
      resultJson: '{"ok":true}',
    });
    const waitMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(settled), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const getMock = vi.fn(async () => makeWorkflowRun({ id: "wfr_wait" }));
    createClientMock.mockReturnValue(
      asServerClient({
        api: {
          v1: {
            "workflow-runs": {
              ":id": { $get: getMock, wait: { $get: waitMock } },
            },
          },
        },
      }),
    );

    await runWorkflowCommand(["wait", "wfr_wait", "--poll-interval", "1"]);

    expect(waitMock).toHaveBeenCalledTimes(2);
    // One pre-check get plus one get after the 204 round.
    expect(getMock).toHaveBeenCalledTimes(2);
    const output = collectLogLines().join("\n");
    expect(output).toContain("Workflow run wfr_wait completed in 30s.");
    expect(output).toContain('{"ok":true}');
  });

  it("workflow wait exits 1 when the run failed", async () => {
    const failed = makeWorkflowRun({
      id: "wfr_failed",
      status: "failed",
      failureReason: "command_expired",
    });
    const waitMock = vi.fn(
      async () =>
        new Response(JSON.stringify(failed), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const getMock = vi.fn(async () => failed);
    createClientMock.mockReturnValue(
      asServerClient({
        api: {
          v1: {
            "workflow-runs": {
              ":id": { $get: getMock, wait: { $get: waitMock } },
            },
          },
        },
      }),
    );

    await expect(runWorkflowCommand(["wait", "wfr_failed"])).rejects.toThrow(
      "process.exit:1",
    );
    expect(collectErrorLines().join("\n")).toContain(
      "Workflow run wfr_failed failed: command_expired",
    );
  });

  it("workflow wait exits 1 when the run was cancelled", async () => {
    const cancelled = makeWorkflowRun({ id: "wfr_gone", status: "cancelled" });
    const waitMock = vi.fn(
      async () =>
        new Response(JSON.stringify(cancelled), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const getMock = vi.fn(async () =>
      makeWorkflowRun({ id: "wfr_gone", status: "running" }),
    );
    createClientMock.mockReturnValue(
      asServerClient({
        api: {
          v1: {
            "workflow-runs": {
              ":id": { $get: getMock, wait: { $get: waitMock } },
            },
          },
        },
      }),
    );

    await expect(runWorkflowCommand(["wait", "wfr_gone"])).rejects.toThrow(
      "process.exit:1",
    );
    expect(collectErrorLines().join("\n")).toContain(
      "Workflow run wfr_gone was cancelled.",
    );
  });

  it("workflow wait exits 4 with a resume hint for interrupted runs", async () => {
    const waitMock = vi.fn(async () => new Response(null, { status: 204 }));
    const getMock = vi.fn(async () =>
      makeWorkflowRun({ id: "wfr_int", status: "interrupted" }),
    );
    createClientMock.mockReturnValue(
      asServerClient({
        api: {
          v1: {
            "workflow-runs": {
              ":id": { $get: getMock, wait: { $get: waitMock } },
            },
          },
        },
      }),
    );

    await expect(runWorkflowCommand(["wait", "wfr_int"])).rejects.toThrow(
      "process.exit:4",
    );
    expect(collectErrorLines().join("\n")).toContain(
      "bb workflow resume wfr_int",
    );
  });

  it("workflow wait exits 2 on timeout", async () => {
    const waitMock = vi.fn(async () => new Response(null, { status: 204 }));
    const getMock = vi.fn(async () =>
      makeWorkflowRun({ id: "wfr_slow", status: "running" }),
    );
    createClientMock.mockReturnValue(
      asServerClient({
        api: {
          v1: {
            "workflow-runs": {
              ":id": { $get: getMock, wait: { $get: waitMock } },
            },
          },
        },
      }),
    );

    await expect(
      runWorkflowCommand(["wait", "wfr_slow", "--timeout", "0"]),
    ).rejects.toThrow("process.exit:2");
    expect(collectErrorLines().join("\n")).toContain(
      "Timed out waiting for workflow run wfr_slow",
    );
  });

  it("workflow cancel acks and maps the archived 409", async () => {
    const cancelMock = vi.fn(async () => new Response(null, { status: 200 }));
    createClientMock.mockReturnValue(
      asServerClient({
        api: {
          v1: { "workflow-runs": { ":id": { cancel: { $post: cancelMock } } } },
        },
      }),
    );
    await runWorkflowCommand(["cancel", "wfr_live"]);
    expect(cancelMock).toHaveBeenCalledWith({ param: { id: "wfr_live" } });
    expect(collectLogLines().join("\n")).toContain(
      "Workflow run wfr_live cancellation requested.",
    );

    cancelMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "workflow_run_archived",
          message: "Workflow run is archived",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(runWorkflowCommand(["cancel", "wfr_old"])).rejects.toThrow(
      "process.exit:1",
    );
    expect(collectErrorLines().join("\n")).toContain(
      "Workflow run wfr_old is archived.",
    );
  });

  it("workflow resume acks with the re-attach hint", async () => {
    const resumeMock = vi.fn(async () => new Response(null, { status: 200 }));
    createClientMock.mockReturnValue(
      asServerClient({
        api: {
          v1: { "workflow-runs": { ":id": { resume: { $post: resumeMock } } } },
        },
      }),
    );

    await runWorkflowCommand(["resume", "wfr_int"]);

    expect(resumeMock).toHaveBeenCalledWith({ param: { id: "wfr_int" } });
    expect(collectLogLines().join("\n")).toContain(
      "Workflow run wfr_int resume requested. Re-attach with 'bb workflow wait wfr_int'.",
    );
  });

  it("workflow resume maps the not-resumable 409", async () => {
    const resumeMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "workflow_run_not_resumable",
            message: "Only interrupted workflow runs can be resumed",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
    );
    createClientMock.mockReturnValue(
      asServerClient({
        api: {
          v1: { "workflow-runs": { ":id": { resume: { $post: resumeMock } } } },
        },
      }),
    );

    await expect(runWorkflowCommand(["resume", "wfr_done"])).rejects.toThrow(
      "process.exit:1",
    );
    expect(collectErrorLines().join("\n")).toContain(
      "Workflow run wfr_done is not interrupted",
    );
  });

  it("workflow validate accepts a valid file and reports lint findings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-workflow-test-"));
    const valid = join(dir, "valid.workflow.js");
    await writeFile(valid, VALID_WORKFLOW_SOURCE, "utf8");
    await runWorkflowCommand(["validate", valid]);
    const output = collectLogLines().join("\n");
    expect(output).toContain("is a valid workflow.");
    expect(output).toContain("Name: lint-check");

    const nondeterministic = join(dir, "bad.workflow.js");
    await writeFile(
      nondeterministic,
      VALID_WORKFLOW_SOURCE.replace("log(out.text);", "log(Date.now());"),
      "utf8",
    );
    await expect(
      runWorkflowCommand(["validate", nondeterministic]),
    ).rejects.toThrow("process.exit:1");
    const lintOutput = collectErrorLines().join("\n");
    expect(lintOutput).toContain(nondeterministic);
    expect(lintOutput).toContain("violates the determinism contract");
    expect(lintOutput).toContain("Date.now() (use now() instead)");
  });

  it("workflow validate rejects non-literal meta without executing it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-workflow-test-"));
    const file = join(dir, "iife.workflow.js");
    await writeFile(
      file,
      `export const meta = { name: (() => "x")(), description: "d" };\n`,
      "utf8",
    );
    await expect(runWorkflowCommand(["validate", file])).rejects.toThrow(
      "process.exit:1",
    );
    const output = collectErrorLines().join("\n");
    expect(output).toContain(file);
    expect(output).toContain("pure literal");
    // The structural parser reports WHERE the non-literal starts (offset
    // within the meta literal), so authors can find the offending expression.
    expect(output).toMatch(/unexpected token `\(` at offset \d+/);
  });

  it("workflow save copies a validated file into <dataDir>/workflows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-workflow-test-"));
    const dataDir = await mkdtemp(join(tmpdir(), "bb-data-dir-"));
    vi.stubEnv("BB_DATA_DIR", dataDir);
    const file = join(dir, "anything.workflow.js");
    await writeFile(file, VALID_WORKFLOW_SOURCE, "utf8");

    await runWorkflowCommand(["save", file]);

    const savedPath = join(dataDir, "workflows", "lint-check.workflow.js");
    expect(await readFile(savedPath, "utf8")).toBe(VALID_WORKFLOW_SOURCE);
    expect(collectLogLines().join("\n")).toContain(
      `Saved workflow 'lint-check' to ${savedPath}`,
    );
  });

  it("workflow save refuses an invalid file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-workflow-test-"));
    const dataDir = await mkdtemp(join(tmpdir(), "bb-data-dir-"));
    vi.stubEnv("BB_DATA_DIR", dataDir);
    const file = join(dir, "bad.workflow.js");
    await writeFile(file, "const nope = 1;\n", "utf8");

    await expect(runWorkflowCommand(["save", file])).rejects.toThrow(
      "process.exit:1",
    );
    expect(collectErrorLines().join("\n")).toContain(
      "must be the first statement",
    );
  });
});

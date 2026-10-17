import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { z } from "zod";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_signature_1";

const autoAskSessionOptions = {
  permissionMode: "auto",
  permissionScope: "workspace",
  approvalReviewer: "automatic",
  permissionEscalation: "ask",
} as const;

const autoDenySessionOptions = {
  ...autoAskSessionOptions,
  permissionEscalation: "deny",
} as const;

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;
let requestLogPath: string;
let scriptPath: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-signature-ws-"));
  requestLogPath = join(workspaceDir, "requests.jsonl");
  scriptPath = join(workspaceDir, "script.json");
  writeFileSync(scriptPath, JSON.stringify({ requestLogPath }));
  stubFakeCodexAppServer(scriptPath);
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  const cleanupId = 991_001;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: "signature-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("keeps the constructed session for a turn whose options carry no envVars", async () => {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: {
      ...FULL_ACCESS_SESSION_OPTIONS,
      envVars: { PATH: "/usr/bin:/bin" },
    },
  });
  const started = await harness.waitForResponse(1);
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_signature2",
    input: [{ type: "text", text: "say hello", mentions: [] }],
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  const turn = await harness.waitForResponse(2);

  expect(turn.error).toBeUndefined();
  expect(
    harness.messages.filter((message) => message.method === "session/replaced"),
  ).toEqual([]);
}, 30_000);

it("keeps an auto-reviewed session when only escalation intent changes", async () => {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: autoAskSessionOptions,
  });
  const started = await harness.waitForResponse(1);
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_signature3",
    input: [{ type: "text", text: "say hello", mentions: [] }],
    options: autoDenySessionOptions,
  });
  const turn = await harness.waitForResponse(2);

  expect(turn.error).toBeUndefined();
  expect(
    harness.messages.filter((message) => message.method === "session/replaced"),
  ).toEqual([]);
}, 30_000);

function recordedRequests() {
  const schema = z.object({
    method: z.string(),
    params: z.looseObject({ serviceTier: z.string().nullable().optional() }),
  });
  return readFileSync(requestLogPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => schema.parse(JSON.parse(line)));
}

it("clears Fast for the next turn without replacing the session", async () => {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...FULL_ACCESS_SESSION_OPTIONS, serviceTier: "fast" },
  });
  const started = await harness.waitForResponse(1);
  expect(started.error).toBeUndefined();
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);

  for (const [index, serviceTier] of ["fast", "default", "fast"].entries()) {
    const id = index + 2;
    harness.sendRequest(id, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      clientRequestId: `creq_tiertestx${id}`,
      input: [{ type: "text", text: "say hello", mentions: [] }],
      options: { ...FULL_ACCESS_SESSION_OPTIONS, serviceTier },
    });
    expect((await harness.waitForResponse(id)).error).toBeUndefined();
    expect(recordedRequests().at(-1)).toEqual({
      method: "turn/start",
      params: expect.objectContaining({
        serviceTier: serviceTier === "default" ? null : "fast",
      }),
    });
  }
  expect(
    harness.messages.filter((message) => message.method === "session/replaced"),
  ).toEqual([]);
}, 30_000);

it.each(["start", "resume", "fork"] as const)(
  "sends an explicit default reset when constructing a %s session",
  async (kind) => {
    harness.sendRequest(1, `thread/${kind}`, {
      threadId: THREAD_ID,
      ...(kind === "resume" ? { providerThreadId: "provider-fast" } : {}),
      ...(kind === "fork" ? { sourceProviderThreadId: "provider-fast" } : {}),
      cwd: workspaceDir,
      instructionMode: "append",
      options: { ...FULL_ACCESS_SESSION_OPTIONS, serviceTier: "default" },
    });
    expect((await harness.waitForResponse(1)).error).toBeUndefined();
    expect(recordedRequests()).toContainEqual({
      method: `thread/${kind}`,
      params: expect.objectContaining({ serviceTier: null }),
    });
  },
  30_000,
);

it.each([
  {
    before: FULL_ACCESS_SESSION_OPTIONS,
    after: autoAskSessionOptions,
    sandbox: "workspaceWrite",
    beforeResponse: false,
    compaction: true,
  },
  {
    before: FULL_ACCESS_SESSION_OPTIONS,
    after: autoAskSessionOptions,
    sandbox: "workspaceWrite",
    beforeResponse: false,
    compaction: false,
  },
  {
    before: FULL_ACCESS_SESSION_OPTIONS,
    after: autoAskSessionOptions,
    sandbox: "workspaceWrite",
    beforeResponse: true,
    compaction: false,
  },
  {
    before: autoAskSessionOptions,
    after: FULL_ACCESS_SESSION_OPTIONS,
    sandbox: "dangerFullAccess",
    beforeResponse: false,
    compaction: false,
  },
])(
  "applies $sandbox before steering (start response pending: $beforeResponse, initial compaction: $compaction)",
  async ({ before, after, sandbox, beforeResponse, compaction }) => {
    if (compaction)
      vi.stubEnv("FAKE_CODEX_COMPACTION_MODE", "wait-for-interrupt");
    writeFileSync(
      scriptPath,
      JSON.stringify({
        requestLogPath,
        startResponseDelayMs: beforeResponse ? 2000 : 0,
      }),
    );
    harness.sendRequest(1, "thread/start", {
      threadId: THREAD_ID,
      cwd: workspaceDir,
      instructionMode: "append",
      options: before,
    });
    const started = await harness.waitForResponse(1);
    const { providerThreadId } = z
      .object({ providerThreadId: z.string() })
      .parse(started.result);
    harness.sendRequest(2, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      clientRequestId: "creq_permstart2",
      input: compaction
        ? [
            {
              type: "text",
              text: "/compact",
              mentions: [
                {
                  start: 0,
                  end: 8,
                  resource: {
                    kind: "command",
                    trigger: "/",
                    name: "compact",
                    source: "command",
                    origin: "builtin",
                    label: "compact",
                    argumentHint: null,
                  },
                },
              ],
            },
          ]
        : [{ type: "text", text: "/wait-for-interrupt", mentions: [] }],
      options: before,
    });
    if (!beforeResponse) {
      expect((await harness.waitForResponse(2)).error).toBeUndefined();
    }
    await vi.waitFor(() =>
      expect(harness.messages).toContainEqual(
        expect.objectContaining({
          method: "thread/delta",
          params: expect.objectContaining({
            deltas: expect.arrayContaining([
              expect.objectContaining({ kind: "turn.open" }),
            ]),
          }),
        }),
      ),
    );
    if (beforeResponse) {
      expect(harness.messages.some((message) => message.id === 2)).toBe(false);
    }
    harness.sendRequest(3, "turn/steer", {
      threadId: THREAD_ID,
      providerThreadId,
      expectedTurnId: "turn-fx-1",
      clientRequestId: "creq_permsteer2",
      input: [
        {
          type: "text",
          text: "Continue with the new permissions",
          mentions: [],
        },
      ],
      options: after,
    });
    expect((await harness.waitForResponse(3)).error).toBeUndefined();
    expect(
      harness.messages.filter(
        (message) => message.method === "session/replaced",
      ),
    ).toEqual([]);
    const requests = recordedRequests();
    expect(requests.filter((entry) => entry.method === "turn/steer")).toEqual(
      [],
    );
    expect(
      requests.filter((entry) => entry.method === "turn/interrupt"),
    ).toHaveLength(1);
    expect(
      requests.filter((entry) => entry.method === "turn/start").at(-1)?.params,
    ).toMatchObject({
      threadId: providerThreadId,
      sandboxPolicy: { type: sandbox },
    });
  },
  30_000,
);

it("applies follow-up permission changes in both directions without replacing the app-server", async () => {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  const started = await harness.waitForResponse(1);
  expect(started.error).toBeUndefined();
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);
  const cases = [
    {
      options: autoAskSessionOptions,
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspaceWrite",
    },
    {
      options: FULL_ACCESS_SESSION_OPTIONS,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "dangerFullAccess",
    },
    {
      options: {
        ...autoAskSessionOptions,
        permissionMode: "accept-edits",
        approvalReviewer: "user",
        permissionEscalation: "deny",
      },
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "workspaceWrite",
    },
  ] as const;
  for (const [index, testCase] of cases.entries()) {
    const id = index + 2;
    harness.sendRequest(id, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      clientRequestId: `creq_permtestx${id}`,
      input: [{ type: "text", text: "say hello", mentions: [] }],
      options: testCase.options,
    });
    expect((await harness.waitForResponse(id)).error).toBeUndefined();
    expect(recordedRequests().at(-1)).toMatchObject({
      method: "turn/start",
      params: {
        approvalPolicy: testCase.approvalPolicy,
        approvalsReviewer: testCase.approvalsReviewer,
        sandboxPolicy: { type: testCase.sandbox },
      },
    });
  }
  expect(
    harness.messages.filter((message) => message.method === "session/replaced"),
  ).toEqual([]);
  expect(
    recordedRequests().filter((request) => request.method === "initialize"),
  ).toHaveLength(1);
}, 30_000);

const workspaceProfileConfig = {
  config: {
    default_permissions: "workspace-dev",
    permissions: {
      "workspace-dev": {
        extends: ":workspace",
        workspace_roots: { "/developer-cache": true },
        filesystem: { "/private-data": "none" },
      },
    },
  },
};

it.each(["start", "resume", "fork"] as const)(
  "preserves the configured workspace profile when constructing a %s session",
  async (kind) => {
    const storageRoot = join(workspaceDir, "thread-storage");
    writeFileSync(
      scriptPath,
      JSON.stringify({ requestLogPath, configRead: workspaceProfileConfig }),
    );
    harness.sendRequest(1, `thread/${kind}`, {
      threadId: THREAD_ID,
      ...(kind === "resume" ? { providerThreadId: "profile-resume" } : {}),
      ...(kind === "fork" ? { sourceProviderThreadId: "profile-fork" } : {}),
      cwd: workspaceDir,
      instructionMode: "append",
      options: {
        ...autoAskSessionOptions,
        providerOptions: { additionalWorkspaceWriteRoots: [storageRoot] },
      },
    });
    const response = await harness.waitForResponse(1);
    const { providerThreadId } = z
      .object({ providerThreadId: z.string() })
      .parse(response.result);
    const started = recordedRequests().find(
      (entry) => entry.method === `thread/${kind}`,
    )?.params;
    expect(started).toMatchObject({
      permissions: "workspace-dev",
      runtimeWorkspaceRoots: [workspaceDir, storageRoot],
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
    });
    expect(started).not.toHaveProperty("sandbox");
    expect(started?.config).not.toHaveProperty(
      "sandbox_workspace_write.writable_roots",
    );
    for (const [index, options] of [
      autoAskSessionOptions,
      FULL_ACCESS_SESSION_OPTIONS,
      autoAskSessionOptions,
    ].entries()) {
      const id = index + 2;
      harness.sendRequest(id, "turn/start", {
        threadId: THREAD_ID,
        providerThreadId,
        clientRequestId: `creq_prmcheckx${id}`,
        input: [{ type: "text", text: "say hello", mentions: [] }],
        options: {
          ...options,
          providerOptions: { additionalWorkspaceWriteRoots: [storageRoot] },
        },
      });
      expect((await harness.waitForResponse(id)).result).toEqual({
        threadId: THREAD_ID,
      });
      const turn = recordedRequests()
        .filter((entry) => entry.method === "turn/start")
        .at(-1)?.params;
      if (options.permissionScope === "workspace") {
        expect(turn).toMatchObject({
          permissions: "workspace-dev",
          runtimeWorkspaceRoots: [workspaceDir, storageRoot],
          approvalsReviewer: "auto_review",
        });
        expect(turn).not.toHaveProperty("sandboxPolicy");
      } else {
        expect(turn).toMatchObject({
          sandboxPolicy: { type: "dangerFullAccess" },
          approvalPolicy: "never",
        });
        expect(turn).not.toHaveProperty("permissions");
      }
    }
  },
  30_000,
);

it("does not promote a workspace session to a configured full-access profile", async () => {
  writeFileSync(
    scriptPath,
    JSON.stringify({
      requestLogPath,
      configRead: {
        config: {
          default_permissions: "unrestricted",
          permissions: { unrestricted: { extends: ":danger-full-access" } },
        },
      },
    }),
  );
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: autoAskSessionOptions,
  });
  const response = await harness.waitForResponse(1);
  expect(response.result).toMatchObject({
    providerThreadId: expect.any(String),
  });
  const started = recordedRequests().find(
    (entry) => entry.method === "thread/start",
  )?.params;
  expect(started).toMatchObject({
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
  });
  expect(started).not.toHaveProperty("permissions");
}, 30_000);

it("interrupts an active profile turn before switching to full access", async () => {
  writeFileSync(
    scriptPath,
    JSON.stringify({ requestLogPath, configRead: workspaceProfileConfig }),
  );
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: autoAskSessionOptions,
  });
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse((await harness.waitForResponse(1)).result);
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_prmcheckx2",
    input: [{ type: "text", text: "/wait-for-interrupt", mentions: [] }],
    options: autoAskSessionOptions,
  });
  await harness.waitForResponse(2);
  await vi.waitFor(() =>
    expect(harness.messages).toContainEqual(
      expect.objectContaining({
        method: "thread/delta",
        params: expect.objectContaining({
          deltas: expect.arrayContaining([
            expect.objectContaining({ kind: "turn.open" }),
          ]),
        }),
      }),
    ),
  );
  harness.sendRequest(3, "turn/steer", {
    threadId: THREAD_ID,
    providerThreadId,
    expectedTurnId: "turn-fx-1",
    clientRequestId: "creq_prmcheckx3",
    input: [{ type: "text", text: "Continue with full access", mentions: [] }],
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  await harness.waitForResponse(3);
  const turns = recordedRequests().filter(
    (entry) => entry.method === "turn/start",
  );
  expect(turns[0]?.params).toMatchObject({
    permissions: "workspace-dev",
    runtimeWorkspaceRoots: [workspaceDir],
  });
  expect(turns.at(-1)?.params).toMatchObject({
    sandboxPolicy: { type: "dangerFullAccess" },
  });
  expect(
    recordedRequests().filter((entry) => entry.method === "turn/interrupt"),
  ).toHaveLength(1);
}, 30_000);

it("retains the legacy sandbox when an older app-server cannot read configuration", async () => {
  writeFileSync(
    scriptPath,
    JSON.stringify({ requestLogPath, configReadError: true }),
  );
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: autoAskSessionOptions,
  });
  const response = await harness.waitForResponse(1);
  expect(response.result).toMatchObject({
    providerThreadId: expect.any(String),
  });
  expect(
    recordedRequests().find((entry) => entry.method === "thread/start")?.params,
  ).toMatchObject({
    sandbox: "workspace-write",
    approvalsReviewer: "auto_review",
  });
}, 30_000);

it("rejects malformed permission configuration instead of silently widening access", async () => {
  writeFileSync(
    scriptPath,
    JSON.stringify({
      requestLogPath,
      configRead: {
        config: {
          default_permissions: "broken",
          permissions: { broken: { extends: 42 } },
        },
      },
    }),
  );
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: autoAskSessionOptions,
  });
  expect((await harness.waitForResponse(1)).error).toMatchObject({
    message: expect.stringContaining("config/read"),
  });
  expect(
    recordedRequests().filter((entry) => entry.method === "thread/start"),
  ).toEqual([]);
}, 30_000);

it.each([":read-only", "inspect-only"])(
  "rejects a %s default with a clear workspace mode error",
  async (profile) => {
    writeFileSync(
      scriptPath,
      JSON.stringify({
        requestLogPath,
        configRead: {
          config: {
            default_permissions: profile,
            permissions: { "inspect-only": { extends: ":read-only" } },
          },
        },
      }),
    );
    harness.sendRequest(1, "thread/start", {
      threadId: THREAD_ID,
      cwd: workspaceDir,
      instructionMode: "append",
      options: autoAskSessionOptions,
    });
    expect((await harness.waitForResponse(1)).error).toMatchObject({
      message:
        "Configured permissions are read-only; BB workspace modes require write access.",
    });
    expect(
      recordedRequests().some((entry) => entry.method === "thread/start"),
    ).toBe(false);
  },
);

it.each(["unsupported-base", "restricted"])(
  "rejects a selected profile with unsupported base %s before starting a thread",
  async (base) => {
    writeFileSync(
      scriptPath,
      JSON.stringify({
        requestLogPath,
        configRead: {
          config: {
            default_permissions: "restricted",
            permissions: { restricted: { extends: base } },
          },
        },
      }),
    );
    harness.sendRequest(1, "thread/start", {
      threadId: THREAD_ID,
      cwd: workspaceDir,
      instructionMode: "append",
      options: autoAskSessionOptions,
    });
    expect((await harness.waitForResponse(1)).error).toMatchObject({
      message:
        "Configured permissions profile has missing or cyclic inheritance.",
    });
    expect(
      recordedRequests().filter((entry) => entry.method === "thread/start"),
    ).toEqual([]);
  },
  30_000,
);

it("refreshes a renamed or removed profile before the next workspace turn", async () => {
  const configPath = join(workspaceDir, "config.json");
  writeFileSync(configPath, JSON.stringify(workspaceProfileConfig));
  writeFileSync(
    scriptPath,
    JSON.stringify({ requestLogPath, configReadPath: configPath }),
  );
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: autoAskSessionOptions,
  });
  const started = await harness.waitForResponse(1);
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);
  for (const [index, profile] of ["renamed-dev", null].entries()) {
    writeFileSync(
      configPath,
      JSON.stringify({
        config: {
          default_permissions: profile,
          permissions: profile ? { [profile]: { extends: ":workspace" } } : {},
        },
      }),
    );
    const id = index + 2;
    harness.sendRequest(id, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      clientRequestId: `creq_prmcheckx${id}`,
      input: [{ type: "text", text: "say hello", mentions: [] }],
      options: autoAskSessionOptions,
    });
    expect((await harness.waitForResponse(id)).result).toEqual({
      threadId: THREAD_ID,
    });
    const turn = recordedRequests()
      .filter((entry) => entry.method === "turn/start")
      .at(-1)?.params;
    if (profile) {
      expect(turn?.permissions).toBe("renamed-dev");
      expect(turn).not.toHaveProperty("sandboxPolicy");
    } else {
      expect(turn).toMatchObject({ sandboxPolicy: { type: "workspaceWrite" } });
      expect(turn).not.toHaveProperty("permissions");
    }
  }
});

it("uses the legacy sandbox when an older server lacks native profile support", async () => {
  writeFileSync(
    scriptPath,
    JSON.stringify({
      requestLogPath,
      configRead: workspaceProfileConfig,
      permissionProfilesUnavailable: true,
    }),
  );
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: autoAskSessionOptions,
  });
  expect((await harness.waitForResponse(1)).result).toHaveProperty(
    "providerThreadId",
  );
  const started = recordedRequests().find(
    (entry) => entry.method === "thread/start",
  )?.params;
  expect(started?.sandbox).toBe("workspace-write");
  expect(started).not.toHaveProperty("permissions");
});

it.each(["start", "resume", "fork"] as const)(
  "rejects a %s response that did not activate the selected profile",
  async (kind) => {
    writeFileSync(
      scriptPath,
      JSON.stringify({
        requestLogPath,
        configRead: workspaceProfileConfig,
        ignorePermissionProfile: true,
      }),
    );
    harness.sendRequest(1, `thread/${kind}`, {
      threadId: THREAD_ID,
      ...(kind === "resume" ? { providerThreadId: "profile-resume" } : {}),
      ...(kind === "fork" ? { sourceProviderThreadId: "profile-fork" } : {}),
      cwd: workspaceDir,
      instructionMode: "append",
      options: autoAskSessionOptions,
    });
    expect((await harness.waitForResponse(1)).error).toMatchObject({
      message: "Codex did not activate the configured permissions profile.",
    });
    expect(
      recordedRequests().some((entry) => entry.method === "turn/start"),
    ).toBe(false);
  },
);

it("checks native support when a full session switches to workspace", async () => {
  writeFileSync(
    scriptPath,
    JSON.stringify({
      requestLogPath,
      configRead: workspaceProfileConfig,
      permissionProfilesUnavailable: true,
    }),
  );
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse((await harness.waitForResponse(1)).result);
  expect(
    recordedRequests().some(
      (entry) => entry.method === "permissionProfile/list",
    ),
  ).toBe(false);
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_prmcheckx2",
    input: [{ type: "text", text: "say hello", mentions: [] }],
    options: autoAskSessionOptions,
  });
  expect((await harness.waitForResponse(2)).result).toEqual({
    threadId: THREAD_ID,
  });
  expect(
    recordedRequests().some(
      (entry) => entry.method === "permissionProfile/list",
    ),
  ).toBe(true);
  const turn = recordedRequests().find(
    (entry) => entry.method === "turn/start",
  )?.params;
  expect(turn).toMatchObject({
    sandboxPolicy: { type: "workspaceWrite", networkAccess: true },
  });
  expect(turn).not.toHaveProperty("permissions");
});

it.each(["chained", "standalone"])(
  "preserves a configured %s profile",
  async (profile) => {
    writeFileSync(
      scriptPath,
      JSON.stringify({
        requestLogPath,
        configRead: {
          config: {
            default_permissions: profile,
            permissions: {
              chained: { extends: "parent" },
              parent: { extends: ":workspace" },
              standalone: {
                filesystem: { ":root": "read", ":workspace_roots": "write" },
              },
            },
          },
        },
      }),
    );
    harness.sendRequest(1, "thread/start", {
      threadId: THREAD_ID,
      cwd: workspaceDir,
      instructionMode: "append",
      options: autoAskSessionOptions,
    });
    expect((await harness.waitForResponse(1)).result).toHaveProperty(
      "providerThreadId",
    );
    const started = recordedRequests().find(
      (entry) => entry.method === "thread/start",
    )?.params;
    expect(started).toMatchObject({
      permissions: profile,
      runtimeWorkspaceRoots: [workspaceDir],
    });
    expect(started).not.toHaveProperty("sandbox");
  },
);

it("does not promote workspace mode through a chain ending in full access", async () => {
  writeFileSync(
    scriptPath,
    JSON.stringify({
      requestLogPath,
      configRead: {
        config: {
          default_permissions: "chained",
          permissions: {
            chained: { extends: "parent" },
            parent: { extends: ":danger-full-access" },
          },
        },
      },
    }),
  );
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: autoAskSessionOptions,
  });
  expect((await harness.waitForResponse(1)).result).toHaveProperty(
    "providerThreadId",
  );
  const started = recordedRequests().find(
    (entry) => entry.method === "thread/start",
  )?.params;
  expect(started?.sandbox).toBe("workspace-write");
  expect(started).not.toHaveProperty("permissions");
});

it.each(["start", "resume", "fork"] as const)(
  "rejects a %s profile whose effective sandbox is unrestricted",
  async (kind) => {
    writeFileSync(
      scriptPath,
      JSON.stringify({
        requestLogPath,
        configRead: workspaceProfileConfig,
        profileSandbox: { type: "externalSandbox", networkAccess: "enabled" },
      }),
    );
    harness.sendRequest(1, `thread/${kind}`, {
      threadId: THREAD_ID,
      ...(kind === "resume" ? { providerThreadId: "profile-resume" } : {}),
      ...(kind === "fork" ? { sourceProviderThreadId: "profile-fork" } : {}),
      cwd: workspaceDir,
      instructionMode: "append",
      options: autoAskSessionOptions,
    });
    expect((await harness.waitForResponse(1)).error).toMatchObject({
      message: "Configured permissions exceed BB workspace isolation.",
    });
    expect(
      recordedRequests().some((entry) => entry.method === "turn/start"),
    ).toBe(false);
  },
);

it("keeps networking enabled for the plain workspace default", async () => {
  writeFileSync(
    scriptPath,
    JSON.stringify({
      requestLogPath,
      configRead: { config: { default_permissions: ":workspace" } },
    }),
  );
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: autoAskSessionOptions,
  });
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse((await harness.waitForResponse(1)).result);
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_prmcheckx2",
    input: [{ type: "text", text: "say hello", mentions: [] }],
    options: autoAskSessionOptions,
  });
  expect((await harness.waitForResponse(2)).result).toEqual({
    threadId: THREAD_ID,
  });
  const turn = recordedRequests().find(
    (entry) => entry.method === "turn/start",
  )?.params;
  expect(turn).toMatchObject({
    sandboxPolicy: { type: "workspaceWrite", networkAccess: true },
  });
  expect(turn).not.toHaveProperty("permissions");
});

it("revalidates a profile changed to unrestricted rules before dispatching a turn", async () => {
  const configPath = join(workspaceDir, "config.json");
  writeFileSync(configPath, JSON.stringify(workspaceProfileConfig));
  writeFileSync(
    scriptPath,
    JSON.stringify({ requestLogPath, configReadPath: configPath }),
  );
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: autoAskSessionOptions,
  });
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse((await harness.waitForResponse(1)).result);
  writeFileSync(
    configPath,
    JSON.stringify({
      config: {
        default_permissions: "workspace-dev",
        permissions: {
          "workspace-dev": {
            extends: ":workspace",
            filesystem: { ":root": "write" },
          },
        },
      },
    }),
  );
  writeFileSync(
    scriptPath,
    JSON.stringify({
      requestLogPath,
      configReadPath: configPath,
      profileSandbox: { type: "externalSandbox", networkAccess: "enabled" },
    }),
  );
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_prmcheckx2",
    input: [{ type: "text", text: "say hello", mentions: [] }],
    options: autoAskSessionOptions,
  });
  expect((await harness.waitForResponse(2)).error).toMatchObject({
    message: "Configured permissions exceed BB workspace isolation.",
  });
  expect(
    recordedRequests().some((entry) => entry.method === "thread/resume"),
  ).toBe(true);
  expect(
    recordedRequests().some((entry) => entry.method === "turn/start"),
  ).toBe(false);
});

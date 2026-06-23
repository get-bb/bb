import { describe, expect, it, vi } from "vitest";
import * as domain from "@bb/domain";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  readlineMocks,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerAutomationCommands } from "../../commands/automation.js";

const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }));

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
}));

function makeAutomation(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "auto-1",
    projectId: domain.PERSONAL_PROJECT_ID,
    name: "Daily digest",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "0 9 * * 1-5",
      timezone: "America/New_York",
    },
    execution: {
      mode: "agent",
      prompt: "Summarize merged PRs.",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "readonly",
    },
    environment: { type: "host", workspace: { type: "personal" } },
    autoArchive: false,
    origin: "human",
    createdByThreadId: null,
    nextRunAt: 1000,
    lastRunAt: null,
    runCount: 0,
    lastRunStatus: null,
    lastRunThreadId: null,
    lastError: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("bb automation command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerAutomationCommands(program, () => "http://server");

  function captureCommanderErrors() {
    return vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  }

  it("create maps agent flags to a schedule + agent execution request", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    const created = makeAutomation({ id: "auto-created", projectId: "proj-1" });
    const post = vi.fn(async () => created);
    stubServerApi({ "v1.projects.:id.automations.$post": post });

    await runCommand(
      [
        "automation",
        "create",
        "--project",
        "proj-1",
        "--name",
        "Daily digest",
        "--cron",
        "0 9 * * 1-5",
        "--timezone",
        "America/New_York",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
        "--prompt",
        "Summarize merged PRs.",
        "--environment",
        "env-1",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      param: { id: "proj-1" },
      json: {
        name: "Daily digest",
        trigger: {
          triggerType: "schedule",
          cron: "0 9 * * 1-5",
          timezone: "America/New_York",
        },
        execution: {
          mode: "agent",
          prompt: "Summarize merged PRs.",
          providerId: "codex",
          model: "gpt-5",
          permissionMode: "readonly",
        },
        environment: { type: "reuse", environmentId: "env-1" },
        origin: "human",
      },
    });
  });

  it("create reads --script-file content and builds a script execution request", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    readFileMock.mockResolvedValueOnce("echo hi\n");
    const created = makeAutomation({
      id: "auto-script",
      projectId: "proj-1",
      execution: { mode: "script", scriptFile: "disk.sh", timeoutMs: 30000 },
    });
    const post = vi.fn(async () => created);
    stubServerApi({ "v1.projects.:id.automations.$post": post });

    await runCommand(
      [
        "automation",
        "create",
        "--project",
        "proj-1",
        "--name",
        "Disk watchdog",
        "--cron",
        "*/15 * * * *",
        "--timezone",
        "America/New_York",
        "--script-file",
        "./disk.sh",
        "--interpreter",
        "bash",
        "--timeout",
        "30000",
        "--environment",
        "env-1",
      ],
      register,
    );

    expect(readFileMock).toHaveBeenCalledWith("./disk.sh", "utf8");
    expect(post).toHaveBeenCalledWith({
      param: { id: "proj-1" },
      json: {
        name: "Disk watchdog",
        trigger: {
          triggerType: "schedule",
          cron: "*/15 * * * *",
          timezone: "America/New_York",
        },
        execution: {
          mode: "script",
          script: "echo hi\n",
          interpreter: "bash",
          timeoutMs: 30000,
        },
        environment: { type: "reuse", environmentId: "env-1" },
        origin: "human",
      },
    });
  });

  it("create infers the interpreter from the --script-file extension", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    readFileMock.mockResolvedValueOnce("print('hi')\n");
    const created = makeAutomation({
      id: "auto-py",
      projectId: "proj-1",
      execution: { mode: "script", scriptFile: "check.py" },
    });
    const post = vi.fn(async () => created);
    stubServerApi({ "v1.projects.:id.automations.$post": post });

    await runCommand(
      [
        "automation",
        "create",
        "--project",
        "proj-1",
        "--name",
        "Py check",
        "--cron",
        "*/15 * * * *",
        "--timezone",
        "America/New_York",
        // No --interpreter: it must be inferred from the .py extension.
        "--script-file",
        "./tools/check.py",
        "--environment",
        "env-1",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          execution: {
            mode: "script",
            script: "print('hi')\n",
            interpreter: "python3",
          },
        }),
      }),
    );
  });

  it("create stamps origin agent and createdByThreadId when BB_THREAD_ID is set", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    vi.stubEnv("BB_THREAD_ID", "thr-creator");
    const created = makeAutomation({ id: "auto-agent", projectId: "proj-1" });
    const post = vi.fn(async () => created);
    stubServerApi({ "v1.projects.:id.automations.$post": post });

    await runCommand(
      [
        "automation",
        "create",
        "--project",
        "proj-1",
        "--name",
        "Daily digest",
        "--cron",
        "0 9 * * 1-5",
        "--timezone",
        "America/New_York",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
        "--prompt",
        "Summarize merged PRs.",
        "--environment",
        "env-1",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          origin: "agent",
          createdByThreadId: "thr-creator",
        }),
      }),
    );
  });

  it("create rejects mixing agent and script flags", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    const post = vi.fn();
    stubServerApi({ "v1.projects.:id.automations.$post": post });

    await expect(
      runCommand(
        [
          "automation",
          "create",
          "--project",
          "proj-1",
          "--name",
          "Mixed",
          "--cron",
          "0 9 * * 1-5",
          "--timezone",
          "America/New_York",
          "--prompt",
          "hi",
          "--script",
          "echo hi",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(post).not.toHaveBeenCalled();
  });

  it("create requires an explicit --project", async () => {
    vi.stubEnv("BB_PROJECT_ID", undefined);
    const post = vi.fn();
    const stderrWrite = captureCommanderErrors();
    stubServerApi({ "v1.projects.:id.automations.$post": post });

    await expect(
      runCommand(
        [
          "automation",
          "create",
          "--name",
          "Personal task",
          "--cron",
          "0 9 * * 1-5",
          "--timezone",
          "America/New_York",
          "--provider",
          "codex",
          "--model",
          "gpt-5",
          "--prompt",
          "Do the thing.",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining(
        "error: required option '--project <id>' not specified",
      ),
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("create uses the personal workspace when the personal project is explicit", async () => {
    const created = makeAutomation({ id: "auto-personal" });
    const post = vi.fn(async () => created);
    stubServerApi({ "v1.projects.:id.automations.$post": post });

    await runCommand(
      [
        "automation",
        "create",
        "--project",
        domain.PERSONAL_PROJECT_ID,
        "--name",
        "Personal task",
        "--cron",
        "0 9 * * 1-5",
        "--timezone",
        "America/New_York",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
        "--prompt",
        "Do the thing.",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        param: { id: domain.PERSONAL_PROJECT_ID },
      }),
    );
  });

  it("list --json prints raw automations for the resolved project", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    const automations = [makeAutomation({ id: "auto-1", projectId: "proj-1" })];
    const get = vi.fn(async () => automations);
    stubServerApi({ "v1.projects.:id.automations.$get": get });

    await runCommand(
      ["automation", "list", "--project", "proj-1", "--json"],
      register,
    );

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual(automations);
    expect(get).toHaveBeenCalledWith({ param: { id: "proj-1" } });
  });

  it("run --json prints the created run", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    const run = {
      run: {
        id: "arun-1",
        automationId: "auto-1",
        runMode: "agent",
        threadId: "thr-spawned",
        status: "running",
        trigger: "manual",
        skipReason: null,
        error: null,
        output: null,
        exitCode: null,
        scheduledFor: 1,
        startedAt: 1,
        finishedAt: null,
      },
    };
    const post = vi.fn(async () => run);
    stubServerApi({
      "v1.projects.:id.automations.:automationId.run.$post": post,
    });

    await runCommand(
      ["automation", "run", "auto-1", "--project", "proj-1", "--json"],
      register,
    );

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual(run);
    expect(post).toHaveBeenCalledWith({
      param: { id: "proj-1", automationId: "auto-1" },
      json: {},
    });
  });

  it("delete prompts for confirmation unless --yes is passed", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    const del = vi.fn(async () => ({ ok: true }));
    stubServerApi({
      "v1.projects.:id.automations.:automationId.$delete": del,
    });
    readlineMocks.question.mockResolvedValueOnce("n");

    await runCommand(
      ["automation", "delete", "auto-1", "--project", "proj-1"],
      register,
    );

    expect(readlineMocks.question).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.log))).toContain("Aborted.");
  });

  it("delete --yes deletes without prompting", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj-1");
    const del = vi.fn(async () => ({ ok: true }));
    stubServerApi({
      "v1.projects.:id.automations.:automationId.$delete": del,
    });

    await runCommand(
      ["automation", "delete", "auto-1", "--project", "proj-1", "--yes"],
      register,
    );

    expect(readlineMocks.question).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith({
      param: { id: "proj-1", automationId: "auto-1" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Automation auto-1 deleted",
    );
  });
});

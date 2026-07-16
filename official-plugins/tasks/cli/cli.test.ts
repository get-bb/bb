import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import plugin from "../server";

function stdout(result: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): string {
  expect(result, result.stderr).toMatchObject({ exitCode: 0, stderr: "" });
  return result.stdout;
}

describe("bb tasks CLI", () => {
  it("lists seed-demo in help while retaining the explicit confirmation guard", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    await plugin(bb);

    expect(stdout(await harness.runCli(["--help"]))).toContain(
      "seed-demo                      Create sample data (requires --yes)",
    );
    await expect(harness.runCli(["seed-demo"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "seed-demo creates sample data; re-run with --yes",
    });

    await harness.dispose();
  });

  it("runs create, list, show, update, and comment through case-insensitive key addressing", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    await plugin(bb);

    const projectResult = await harness.runCli([
      "project",
      "create",
      "--name",
      "CLI Project",
      "--prefix",
      "CLI",
      "--json",
    ]);
    const projectPayload = JSON.parse(stdout(projectResult));
    expect(projectPayload).toMatchObject({
      project: { name: "CLI Project", prefix: "CLI" },
    });

    const labelResult = await harness.runCli([
      "label",
      "create",
      "--project",
      "cli",
      "--name",
      "Backend",
      "--json",
    ]);
    expect(JSON.parse(stdout(labelResult))).toMatchObject({
      label: { name: "Backend", projectId: projectPayload.project.id },
    });

    const createResult = await harness.runCli([
      "create",
      "--project",
      "cli",
      "--title",
      "Ship the canonical CLI",
      "--description",
      "Created from the test harness.",
      "--priority",
      "medium",
      "--label",
      "Backend",
      "--json",
    ]);
    const createPayload = JSON.parse(stdout(createResult));
    expect(createPayload).toMatchObject({
      task: {
        key: "CLI-1",
        title: "Ship the canonical CLI",
        priority: "medium",
      },
    });

    const listResult = await harness.runCli(["list", "--project", "CLI"]);
    expect(stdout(listResult)).toContain(
      "KEY    STATUS   PRIORITY  TITLE                   LABELS   AGENTS",
    );
    expect(listResult.stdout).toContain(
      "CLI-1  backlog  medium    Ship the canonical CLI  Backend  0",
    );

    const showResult = await harness.runCli(["show", "cli-1", "--json"]);
    const showPayload = JSON.parse(stdout(showResult));
    expect(showPayload).toMatchObject({
      task: { id: createPayload.task.id, key: "CLI-1" },
      project: { prefix: "CLI" },
      labels: [{ name: "Backend" }],
      subtasks: [],
      attachments: [],
      taskThreads: [],
      comments: [],
    });

    const updateResult = await harness.runCli([
      "update",
      "cli-1",
      "--status",
      "in_progress",
      "--priority",
      "high",
      "--due",
      "2026-07-20",
      "--json",
    ]);
    expect(JSON.parse(stdout(updateResult))).toMatchObject({
      task: {
        id: createPayload.task.id,
        status: "in_progress",
        priority: "high",
        dueDate: "2026-07-20",
      },
    });

    const commentResult = await harness.runCli(
      ["comment", "CLI-1", "--body", "Ready for review.", "--json"],
      { threadId: "thr_cli_worker", projectId: "proj_bb" },
    );
    expect(JSON.parse(stdout(commentResult))).toMatchObject({
      comment: {
        taskId: createPayload.task.id,
        kind: "agent",
        authorName: "agent (thr_cli_worker)",
        threadId: "thr_cli_worker",
        body: "Ready for review.",
        notifiedCount: 0,
      },
    });

    const updatedShow = JSON.parse(
      stdout(await harness.runCli(["show", createPayload.task.id, "--json"])),
    );
    expect(updatedShow.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "system",
          body: "Status changed to In Progress by cli",
        }),
        expect.objectContaining({
          kind: "system",
          body: "Priority changed to High by cli",
        }),
        expect.objectContaining({ kind: "agent", body: "Ready for review." }),
      ]),
    );

    await harness.dispose();
  });

  it("defaults create and list to the tracker project linked to CLI project context", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    await plugin(bb);
    const context = { projectId: "proj_linked" };

    stdout(
      await harness.runCli([
        "project",
        "create",
        "--name",
        "Linked",
        "--prefix",
        "LINK",
        "--link-bb-project",
        context.projectId,
      ]),
    );
    const task = JSON.parse(
      stdout(
        await harness.runCli(
          ["create", "--title", "Uses project context", "--json"],
          context,
        ),
      ),
    ).task;
    expect(task).toMatchObject({
      key: "LINK-1",
      title: "Uses project context",
    });

    const listed = JSON.parse(
      stdout(await harness.runCli(["list", "--json"], context)),
    );
    expect(listed.tasks).toEqual([
      expect.objectContaining({ id: task.id, agentsWorking: 0 }),
    ]);

    const missing = await harness.runCli(["create", "--title", "No link"], {
      projectId: "proj_missing",
    });
    expect(missing).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr:
        "no tracker project is linked to BB project proj_missing; pass --project or link one with bb tasks project update",
    });

    await harness.dispose();
  });

  it("returns single-line friendly errors for invalid statuses and unknown keys", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    await plugin(bb);
    stdout(
      await harness.runCli([
        "project",
        "create",
        "--name",
        "Errors",
        "--prefix",
        "ERR",
      ]),
    );
    stdout(
      await harness.runCli([
        "create",
        "--project",
        "ERR",
        "--title",
        "Validate errors",
      ]),
    );

    const invalidStatus = await harness.runCli([
      "update",
      "ERR-1",
      "--status",
      "almost-done",
    ]);
    expect(invalidStatus).toMatchObject({ exitCode: 1, stdout: "" });
    expect(invalidStatus.stderr).toContain("status:");
    expect(invalidStatus.stderr).toContain("Invalid option");
    expect(invalidStatus.stderr).not.toContain("\n");

    await expect(harness.runCli(["show", "ERR-404"])).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "task not found: ERR-404",
    });

    await harness.dispose();
  });

  it("validates combined project and folder updates before mutating", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    await plugin(bb);
    stdout(
      await harness.runCli([
        "project",
        "create",
        "--name",
        "Atomic project",
        "--prefix",
        "ATOM",
      ]),
    );
    stdout(
      await harness.runCli(["folder", "create", "--name", "Original folder"]),
    );

    const invalidProjectUpdate = await harness.runCli([
      "project",
      "update",
      "ATOM",
      "--rename-prefix",
      "NEXT",
      "--link-bb-project",
      "not-a-project-id",
    ]);
    expect(invalidProjectUpdate).toMatchObject({ exitCode: 1, stdout: "" });
    expect(
      JSON.parse(
        stdout(await harness.runCli(["project", "show", "ATOM", "--json"])),
      ).project,
    ).toMatchObject({ prefix: "ATOM", linkedBbProjectId: null });

    await expect(
      harness.runCli([
        "folder",
        "update",
        "Original folder",
        "--name",
        "Partially renamed",
        "--parent",
        "Missing parent",
      ]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "folder not found: Missing parent",
    });
    const folders = JSON.parse(
      stdout(await harness.runCli(["folder", "list", "--json"])),
    ).folders;
    expect(folders).toEqual([
      expect.objectContaining({
        name: "Original folder",
        parentFolderId: null,
      }),
    ]);

    await harness.dispose();
  });

  it("creates, updates, lists, and deletes delegation presets", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        hosts: {
          list: async () => [
            { id: "host_air", name: "Sawyer Air" },
            { id: "host_box", name: "Build box" },
          ],
        },
      },
    });
    await plugin(bb);

    const created = JSON.parse(
      stdout(
        await harness.runCli([
          "preset",
          "create",
          "--name",
          "CLI worker",
          "--provider",
          "codex",
          "--model",
          "gpt-5.6-sol",
          "--reasoning",
          "high",
          "--permission",
          "workspace-write",
          "--environment",
          "worktree",
          "--base-branch",
          "main",
          "--machine",
          "Sawyer Air",
          "--instructions",
          "Start with the failing test.",
          "--json",
        ]),
      ),
    ).preset;
    expect(created).toMatchObject({
      name: "CLI worker",
      providerId: "codex",
      permissionMode: "workspace-write",
      environmentKind: "new-worktree",
      baseBranch: "main",
      machineId: "host_air",
      builtin: false,
    });
    const shown = stdout(
      await harness.runCli(["preset", "show", "CLI worker"]),
    );
    expect(shown).toContain("Environment   worktree");
    expect(shown).toContain("Base branch   main");
    expect(shown).toContain("Machine       host_air");

    const updated = JSON.parse(
      stdout(
        await harness.runCli([
          "preset",
          "update",
          "CLI worker",
          "--reasoning",
          "xhigh",
          "--name",
          "CLI reviewer",
          "--environment",
          "project-default",
          "--json",
        ]),
      ),
    ).preset;
    expect(updated).toMatchObject({
      id: created.id,
      name: "CLI reviewer",
      reasoningLevel: "xhigh",
      environmentKind: "project-default",
      baseBranch: null,
      machineId: null,
    });

    const listTable = stdout(await harness.runCli(["preset", "list"]));
    expect(listTable).toContain("ENVIRONMENT");
    expect(listTable).toContain("BASE BRANCH");
    expect(listTable).toContain("MACHINE");

    const listed = JSON.parse(
      stdout(await harness.runCli(["preset", "list", "--json"])),
    ).presets;
    expect(listed).toEqual([
      expect.objectContaining({ id: created.id, name: "CLI reviewer" }),
    ]);

    expect(
      JSON.parse(
        stdout(
          await harness.runCli(["preset", "delete", "CLI reviewer", "--json"]),
        ),
      ),
    ).toMatchObject({ deleted: true, preset: { id: created.id } });

    await harness.dispose();
  });

  it("reports friendly preset target validation errors", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    await plugin(bb);
    const required = [
      "preset",
      "create",
      "--name",
      "Invalid target",
      "--provider",
      "codex",
      "--model",
      "gpt-5.6-sol",
      "--reasoning",
      "high",
      "--permission",
      "full",
    ];

    await expect(
      harness.runCli([...required, "--environment", "branch"]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr:
        "invalid --environment branch; expected project-default or worktree",
    });
    await expect(
      harness.runCli([...required, "--base-branch", "main"]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "--base-branch requires --environment worktree",
    });
    await expect(
      harness.runCli([...required, "--machine", "missing"]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "--machine requires --environment worktree",
    });

    await harness.dispose();
  });

  it("self-attaches through BB_THREAD_ID and lists the live thread status", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async () => ({
            id: "thr_cli_self",
            title: "CLI self attach",
            titleFallback: null,
            status: "active",
          }),
          send: async () => undefined,
        },
      },
    });
    await plugin(bb);
    stdout(
      await harness.runCli([
        "project",
        "create",
        "--name",
        "Attach",
        "--prefix",
        "ATT",
      ]),
    );
    stdout(
      await harness.runCli([
        "create",
        "--project",
        "ATT",
        "--title",
        "Attach this worker",
      ]),
    );

    const previousThreadId = process.env.BB_THREAD_ID;
    process.env.BB_THREAD_ID = "thr_cli_self";
    try {
      expect(
        JSON.parse(stdout(await harness.runCli(["attach", "ATT-1", "--json"]))),
      ).toMatchObject({ task: { key: "ATT-1" }, threadId: "thr_cli_self" });
    } finally {
      if (previousThreadId === undefined) delete process.env.BB_THREAD_ID;
      else process.env.BB_THREAD_ID = previousThreadId;
    }

    const threads = JSON.parse(
      stdout(await harness.runCli(["threads", "ATT-1", "--json"])),
    );
    expect(threads.taskThreads).toEqual([
      expect.objectContaining({
        threadId: "thr_cli_self",
        liveStatus: "working",
        presetName: "Attached",
      }),
    ]);

    const notified = JSON.parse(
      stdout(
        await harness.runCli([
          "comment",
          "ATT-1",
          "--body",
          "Include the new edge case.",
          "--notify",
          "--json",
        ]),
      ),
    ).comment;
    expect(notified).toMatchObject({
      taskId: threads.task.id,
      notifiedCount: 1,
    });
    expect(harness.sdk.callsTo("threads.send")).toEqual([
      [
        expect.objectContaining({
          threadId: "thr_cli_self",
          mode: "steer",
        }),
      ],
    ]);

    await harness.dispose();
  });

  it("adds and downloads an attachment with an exact file round-trip", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bb-tasks-cli-"));
    const inputPath = join(directory, "input.txt");
    const pngPath = join(directory, "pixel.png");
    const outputPath = join(directory, "nested", "output.txt");
    await writeFile(inputPath, "attachment bytes from CLI\n", "utf8");
    await writeFile(
      pngPath,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    await plugin(bb);

    try {
      stdout(
        await harness.runCli([
          "project",
          "create",
          "--name",
          "Files",
          "--prefix",
          "FILE",
        ]),
      );
      stdout(
        await harness.runCli([
          "create",
          "--project",
          "FILE",
          "--title",
          "Round-trip a file",
        ]),
      );

      const attachment = JSON.parse(
        stdout(
          await harness.runCli([
            "attachment",
            "add",
            "FILE-1",
            "--file",
            inputPath,
            "--name",
            "renamed.txt",
            "--json",
          ]),
        ),
      ).attachment;
      expect(attachment).toMatchObject({
        fileName: "renamed.txt",
        mime: "application/octet-stream",
        sizeBytes: 26,
        isImage: false,
      });

      const signalsBeforePng = harness.realtimeSignals.length;
      const pngAttachment = JSON.parse(
        stdout(
          await harness.runCli([
            "attachment",
            "add",
            "FILE-1",
            "--file",
            pngPath,
            "--json",
          ]),
        ),
      ).attachment;
      expect(pngAttachment).toMatchObject({
        fileName: "pixel.png",
        mime: "image/png",
        sizeBytes: 8,
        isImage: true,
      });
      expect(harness.realtimeSignals.slice(signalsBeforePng)).toEqual([
        {
          channel: "tasks:changed",
          payload: {
            taskId: pngAttachment.taskId,
            projectId: expect.any(String),
          },
        },
      ]);

      const listed = JSON.parse(
        stdout(
          await harness.runCli(["attachment", "list", "FILE-1", "--json"]),
        ),
      );
      expect(listed.attachments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: attachment.id }),
          expect.objectContaining({ id: pngAttachment.id }),
        ]),
      );

      const comment = JSON.parse(
        stdout(
          await harness.runCli([
            "comment",
            "FILE-1",
            "--body",
            "Attach the source to this comment.",
            "--json",
          ]),
        ),
      ).comment;
      const commentAttachment = JSON.parse(
        stdout(
          await harness.runCli([
            "attachment",
            "add",
            comment.id,
            "--file",
            inputPath,
            "--json",
          ]),
        ),
      ).attachment;
      expect(commentAttachment).toMatchObject({
        taskId: null,
        commentId: comment.id,
      });
      const listedWithCommentAttachment = JSON.parse(
        stdout(
          await harness.runCli(["attachment", "list", "FILE-1", "--json"]),
        ),
      );
      expect(listedWithCommentAttachment.attachments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: attachment.id }),
          expect.objectContaining({ id: commentAttachment.id }),
        ]),
      );

      stdout(
        await harness.runCli([
          "attachment",
          "get",
          attachment.id,
          "--out",
          outputPath,
        ]),
      );
      expect(await readFile(outputPath, "utf8")).toBe(
        "attachment bytes from CLI\n",
      );
    } finally {
      await harness.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns a friendly dispatch error when the task project is not linked", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    await plugin(bb);
    stdout(
      await harness.runCli([
        "project",
        "create",
        "--name",
        "Unlinked CLI",
        "--prefix",
        "UNL",
      ]),
    );
    stdout(
      await harness.runCli([
        "create",
        "--project",
        "UNL",
        "--title",
        "Cannot dispatch yet",
      ]),
    );
    stdout(
      await harness.runCli([
        "preset",
        "create",
        "--name",
        "CLI worker",
        "--provider",
        "codex",
        "--model",
        "gpt-5.6-sol",
        "--reasoning",
        "high",
        "--permission",
        "full",
      ]),
    );

    const result = await harness.runCli([
      "dispatch",
      "UNL-1",
      "--preset",
      "CLI worker",
    ]);
    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: 'Task project "Unlinked CLI" is not linked to a bb project',
    });
    // "delegate" stays as a hidden compatibility alias for "dispatch".
    const aliased = await harness.runCli([
      "delegate",
      "UNL-1",
      "--preset",
      "CLI worker",
    ]);
    expect(aliased.stderr).toBe(
      'Task project "Unlinked CLI" is not linked to a bb project',
    );
    expect(harness.sdk.callsTo("threads.spawn")).toEqual([]);

    await harness.dispose();
  });
});

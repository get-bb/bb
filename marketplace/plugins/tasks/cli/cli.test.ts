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
});

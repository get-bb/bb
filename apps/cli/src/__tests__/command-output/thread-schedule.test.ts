import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  collectLogPayloads,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread schedule command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread schedule list calls the schedules endpoint and renders the table", async () => {
    const schedule = fixtures.makeThreadSchedule({
      id: "tsched_list",
      projectId: "proj-1",
      threadId: "thread-schedule-list",
      name: "Morning recap",
    });
    const get = vi.fn(async () => [schedule]);
    stubServerApi({ "v1.threads.:id.schedules.$get": get });

    await runCommand(
      ["thread", "schedule", "list", "thread-schedule-list"],
      register,
    );

    expect(get).toHaveBeenCalledWith({
      param: { id: "thread-schedule-list" },
    });
    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("tsched_list");
    expect(output).toContain("Morning recap");
    expect(output).toContain("0 8 * * 1-5");
  });

  it("bb thread schedule list --self --json prints raw schedules", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-schedule-self");
    const schedule = fixtures.makeThreadSchedule({
      id: "tsched_self",
      projectId: "proj-1",
      threadId: "thread-schedule-self",
    });
    const get = vi.fn(async () => [schedule]);
    stubServerApi({ "v1.threads.:id.schedules.$get": get });

    await runCommand(
      ["thread", "schedule", "list", "--self", "--json"],
      register,
    );

    expect(get).toHaveBeenCalledWith({
      param: { id: "thread-schedule-self" },
    });
    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual([schedule]);
  });

  it("bb thread schedule create omits enabled by default", async () => {
    const schedule = fixtures.makeThreadSchedule({
      id: "tsched_create",
      projectId: "proj-1",
      threadId: "thread-schedule-create",
      name: "Daily recap",
      prompt: "Summarize useful progress.",
    });
    const post = vi.fn(async () => schedule);
    stubServerApi({ "v1.threads.:id.schedules.$post": post });

    await runCommand(
      [
        "thread",
        "schedule",
        "create",
        "thread-schedule-create",
        "--name",
        "Daily recap",
        "--cron",
        "0 8 * * 1-5",
        "--timezone",
        "UTC",
        "--prompt",
        "Summarize useful progress.",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      param: { id: "thread-schedule-create" },
      json: {
        name: "Daily recap",
        cron: "0 8 * * 1-5",
        timezone: "UTC",
        prompt: "Summarize useful progress.",
      },
    });
    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("Schedule tsched_create");
    expect(output).toContain("Enabled:   yes");
  });

  it("bb thread schedule create --self --disabled --json sends enabled false", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-schedule-create-self");
    const schedule = fixtures.makeThreadSchedule({
      id: "tsched_disabled",
      projectId: "proj-1",
      threadId: "thread-schedule-create-self",
      enabled: false,
    });
    const post = vi.fn(async () => schedule);
    stubServerApi({ "v1.threads.:id.schedules.$post": post });

    await runCommand(
      [
        "thread",
        "schedule",
        "create",
        "--self",
        "--name",
        "Paused recap",
        "--cron",
        "0 8 * * *",
        "--timezone",
        "UTC",
        "--prompt",
        "Stay paused.",
        "--disabled",
        "--json",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      param: { id: "thread-schedule-create-self" },
      json: {
        name: "Paused recap",
        cron: "0 8 * * *",
        timezone: "UTC",
        prompt: "Stay paused.",
        enabled: false,
      },
    });
    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual(schedule);
  });

  it("bb thread schedule update sends config patch fields", async () => {
    const schedule = fixtures.makeThreadSchedule({
      id: "tsched_update",
      projectId: "proj-1",
      threadId: "thread-schedule-update",
      name: "Updated recap",
      cron: "0 9 * * *",
      prompt: "Check deployment follow-up.",
    });
    const patch = vi.fn(async () => schedule);
    stubServerApi({ "v1.threads.:id.schedules.:scheduleId.$patch": patch });

    await runCommand(
      [
        "thread",
        "schedule",
        "update",
        "thread-schedule-update",
        "tsched_update",
        "--name",
        "Updated recap",
        "--cron",
        "0 9 * * *",
        "--timezone",
        "UTC",
        "--prompt",
        "Check deployment follow-up.",
      ],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: {
        id: "thread-schedule-update",
        scheduleId: "tsched_update",
      },
      json: {
        name: "Updated recap",
        cron: "0 9 * * *",
        timezone: "UTC",
        prompt: "Check deployment follow-up.",
      },
    });
    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "Schedule tsched_update",
    );
  });

  it("bb thread schedule enable and disable send enabled patch payloads", async () => {
    const patch = vi.fn(async (request: fixtures.ScheduleEnabledPatchRequest) =>
      fixtures.makeThreadSchedule({
        id: "tsched_toggle",
        projectId: "proj-1",
        threadId: "thread-schedule-toggle",
        enabled: request.json.enabled,
      }),
    );
    stubServerApi({ "v1.threads.:id.schedules.:scheduleId.$patch": patch });

    await runCommand(
      [
        "thread",
        "schedule",
        "enable",
        "thread-schedule-toggle",
        "tsched_toggle",
      ],
      register,
    );
    await runCommand(
      [
        "thread",
        "schedule",
        "disable",
        "thread-schedule-toggle",
        "tsched_toggle",
      ],
      register,
    );

    expect(patch).toHaveBeenNthCalledWith(1, {
      param: {
        id: "thread-schedule-toggle",
        scheduleId: "tsched_toggle",
      },
      json: { enabled: true },
    });
    expect(patch).toHaveBeenNthCalledWith(2, {
      param: {
        id: "thread-schedule-toggle",
        scheduleId: "tsched_toggle",
      },
      json: { enabled: false },
    });
  });

  it("bb thread schedule delete calls delete endpoint and supports json output", async () => {
    const del = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.threads.:id.schedules.:scheduleId.$delete": del });

    await runCommand(
      [
        "thread",
        "schedule",
        "delete",
        "thread-schedule-delete",
        "tsched_delete",
        "--json",
      ],
      register,
    );

    expect(del).toHaveBeenCalledWith({
      param: {
        id: "thread-schedule-delete",
        scheduleId: "tsched_delete",
      },
    });
    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual({
      ok: true,
      threadId: "thread-schedule-delete",
      scheduleId: "tsched_delete",
    });
  });
});

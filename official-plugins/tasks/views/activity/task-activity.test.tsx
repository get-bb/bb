// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createComment, createStore } from "../../api/index.js";
import type { DisplayComment } from "../../shared/contract.js";
import {
  AgentNotificationControl,
  agentNotificationTarget,
  CommentComposer,
} from "./task-activity.js";

const { rpcCall } = vi.hoisted(() => ({ rpcCall: vi.fn() }));

vi.mock("../../shell/data.js", () => ({
  useMentionItems: () => [],
  useTasksQuery: () => ({ data: [] }),
  useTasksRpc: () => ({ call: rpcCall }),
}));

vi.mock("@bb/plugin-sdk/app", () => ({
  useBbNavigate: () => ({ toThread: vi.fn() }),
}));

vi.mock("../../editor/tasks-editor.js", () => ({
  TasksEditor: (props: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Comment body"
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  ),
}));

afterEach(() => {
  cleanup();
  rpcCall.mockReset();
});

function comment(
  kind: DisplayComment["kind"],
  threadId: string | null = null,
  threadTitle: string | null = null,
): DisplayComment {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZ${kind === "agent" ? "A" : "U"}`,
    taskId: "01HZZZZZZZZZZZZZZZZZZZZZT1",
    kind,
    authorName: kind === "agent" ? "Agent" : "You",
    presetName: null,
    threadId,
    threadTitle,
    body: "Reply",
    notifiedCount: 0,
    createdAt: "2026-07-15T00:00:00.000Z",
  };
}

describe("agent notification target", () => {
  it("uses the last agent reply rather than the last activity entry", () => {
    expect(
      agentNotificationTarget([
        comment("agent", "thr_first", "First agent"),
        comment("agent", "thr_latest", "Latest agent"),
        comment("user"),
      ]),
    ).toEqual({ kind: "ready", title: "Latest agent" });
  });

  it("distinguishes no prior reply from an unavailable latest responder", () => {
    expect(agentNotificationTarget([comment("user")])).toEqual({
      kind: "none",
    });
    expect(
      agentNotificationTarget([comment("agent", "thr_private", null)]),
    ).toEqual({ kind: "unavailable" });
  });
});

describe("AgentNotificationControl", () => {
  it("exposes an enabled, on-by-default switch named for the latest responder", () => {
    const onCheckedChange = vi.fn();
    render(
      <AgentNotificationControl
        target={{ kind: "ready", title: "Fix the login bug" }}
        checked
        onCheckedChange={onCheckedChange}
      />,
    );

    // Icon-only: the destination lives in the accessible name (and tooltip),
    // not inline text, so it never stretches the composer row.
    const toggle = screen.getByRole("switch", {
      name: "Notify Fix the login bug",
    });
    expect(toggle.getAttribute("aria-disabled")).toBe("false");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("reads as off and toggles on when the opt-in is unchecked", () => {
    const onCheckedChange = vi.fn();
    render(
      <AgentNotificationControl
        target={{ kind: "ready", title: "Fix the login bug" }}
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    const toggle = screen.getByRole("switch", {
      name: "Notify Fix the login bug",
    });
    expect(toggle.getAttribute("aria-disabled")).toBe("false");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("names the full destination even for a long thread title", () => {
    const title =
      "Make all of the filters in the task list remembered across reloads";
    render(
      <AgentNotificationControl
        target={{ kind: "ready", title }}
        checked
        onCheckedChange={vi.fn()}
      />,
    );

    // No inline text to truncate: the whole destination is the accessible name,
    // so screen readers and the tooltip always get the complete title.
    expect(
      screen.getByRole("switch", { name: `Notify ${title}` }),
    ).toBeTruthy();
  });

  it("never reads as on and cannot be toggled while unavailable", () => {
    const onCheckedChange = vi.fn();
    render(
      <AgentNotificationControl
        target={{ kind: "unavailable" }}
        checked
        onCheckedChange={onCheckedChange}
      />,
    );

    const toggle = screen.getByRole("switch", {
      name: "Latest responding agent can’t be notified",
    });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    // `checked` is ignored when there is no valid target: the control must not
    // advertise an armed notification it can't deliver, and clicking is inert.
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("disables and explains the control when no agent has replied", () => {
    const onCheckedChange = vi.fn();
    render(
      <AgentNotificationControl
        target={{ kind: "none" }}
        checked
        onCheckedChange={onCheckedChange}
      />,
    );

    const toggle = screen.getByRole("switch", {
      name: "No prior agent reply to notify",
    });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(toggle);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe("CommentComposer", () => {
  it("single-flights rapid submit activation into one comment and send", async () => {
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async ({ threadId }) =>
            makeThreadResponse({ id: threadId, status: "active" }),
          send: async () => sendGate,
        },
      },
    });
    try {
      const store = createStore(bb);
      const project = store.tasks.createProject({
        name: "Composer",
        prefix: "CMP",
        color: "blue",
      });
      const task = store.tasks.createTask({
        projectId: project.id,
        title: "Submit once",
      });
      store.tasks.createComment({
        taskId: task.id,
        kind: "agent",
        authorName: "Worker",
        threadId: "thr_worker",
        body: "Ready for input",
      });
      rpcCall.mockImplementation(async (method, input) => {
        if (method !== "createComment") {
          throw new Error(`Unexpected RPC method: ${String(method)}`);
        }
        const request = input as {
          taskId: string;
          body: string;
          notify: boolean;
        };
        return {
          comment: await createComment(bb, store, {
            taskId: request.taskId,
            kind: "user",
            authorName: "You",
            presetName: null,
            threadId: null,
            body: request.body,
            notify: request.notify,
          }),
        };
      });

      render(
        <CommentComposer
          taskId={task.id}
          notificationTarget={{ kind: "ready", title: "Worker" }}
        />,
      );
      fireEvent.change(screen.getByRole("textbox", { name: "Comment body" }), {
        target: { value: "Only once" },
      });
      const submit = screen.getByRole("button", { name: "Comment" });
      fireEvent.click(submit);
      fireEvent.click(submit);

      await waitFor(() => expect(rpcCall).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(harness.sdk.callsTo("threads.send")).toHaveLength(1),
      );
      expect(
        store.tasks
          .listComments(task.id)
          .filter((entry) => entry.body === "Only once"),
      ).toHaveLength(1);

      releaseSend();
      await waitFor(() =>
        expect(
          store.tasks
            .listComments(task.id)
            .find((entry) => entry.body === "Only once")?.notifiedCount,
        ).toBe(1),
      );
    } finally {
      releaseSend();
      await harness.dispose();
    }
  });
});

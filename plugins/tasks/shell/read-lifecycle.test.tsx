// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { TasksRefreshProvider } from "./refresh.js";
import { useTasksRead } from "./data.js";
import { TasksSidebarAccessory } from "./sidebar-accessory.js";
import { makeTask } from "../test-fixtures.js";
import { tasksRpcContract } from "../shared/contract.js";

afterEach(cleanup);

it("shares duplicate consumers, scopes task changes, and reconciles each query once on reconnect", async () => {
  const first = makeTask();
  const second = makeTask({
    id: "01HZZZZZZZZZZZZZZZZZZZZZT2",
    title: "Second",
  });
  const reads = vi.fn((input: unknown) => {
    const { taskId } = tasksRpcContract.getTask.input.parse(input);
    return { task: taskId === first.id ? first : second };
  });
  const count = vi.fn(() => ({ openTaskCount: 2 }));
  function Detail({ taskId }: { taskId: string }) {
    const query = useTasksRead("getTask", { taskId }, (result) => result.task, [
      "tasks:changed",
    ]);
    return <span>{query.data?.title}</span>;
  }
  function Consumers() {
    return (
      <TasksRefreshProvider>
        <Detail taskId={first.id} />
        <Detail taskId={first.id} />
        <Detail taskId={second.id} />
        <TasksSidebarAccessory />
        <TasksSidebarAccessory />
      </TasksRefreshProvider>
    );
  }
  const view = renderSlot(
    { component: Consumers },
    {},
    { rpc: { getTask: reads, sidebarOpenTaskCount: count } },
  );
  await view.findByText("Second");
  expect(reads).toHaveBeenCalledTimes(2);
  expect(count).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 5; i++)
    await view.emitRealtime("tasks:changed", {
      taskId: first.id,
      projectId: first.projectId,
    });
  await waitFor(() => expect(reads).toHaveBeenCalledTimes(3));
  expect(count).toHaveBeenCalledTimes(2);
  expect(
    reads.mock.calls.filter(
      ([input]) =>
        tasksRpcContract.getTask.input.parse(input).taskId === second.id,
    ),
  ).toHaveLength(1);
  await view.setRealtimeConnectionState("reconnecting");
  await view.setRealtimeConnectionState("connected");
  await waitFor(() => expect(reads).toHaveBeenCalledTimes(5));
  expect(count).toHaveBeenCalledTimes(3);
});

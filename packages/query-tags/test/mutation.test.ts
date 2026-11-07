// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
  useTaggedQuery,
  optimisticQueryUpdate,
  useTaggedMutation,
  type TaggedMutationOutcome,
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

afterEach(cleanup);

it("reports only writes awaiting acknowledgement in each hook", async () => {
  const client = new QueryClient();
  const writes = {
    a: deferred<TaggedMutationOutcome<string>>(),
    b: deferred<TaggedMutationOutcome<string>>(),
    c: deferred<TaggedMutationOutcome<string>>(),
  };
  const reread = deferred<void>();
  const reading = deferred<void>();
  type Input = { taskId: keyof typeof writes };
  const call = (input: Input) => writes[input.taskId].promise;
  const invalidate = async (tags: readonly string[]) => {
    if (tags.length) {
      reading.resolve();
      await reread.promise;
    }
  };
  const hooks = renderHook(() => ({
    first: useTaggedMutation<Input, string>({ client, invalidate, call }),
    second: useTaggedMutation<Input, string>({ client, invalidate, call }),
  }));
  let a!: Promise<string>;
  let b!: Promise<string | Error>;
  let c!: Promise<string>;
  act(() => {
    a = hooks.result.current.first.mutate({ taskId: "a" });
    b = hooks.result.current.first
      .mutate({ taskId: "b" })
      .catch((error: Error) => error);
    c = hooks.result.current.second.mutate({ taskId: "c" });
  });
  await waitFor(() => {
    expect(hooks.result.current.first.pendingInputs).toEqual([
      { taskId: "a" },
      { taskId: "b" },
    ]);
    expect(hooks.result.current.second.pendingInputs).toEqual([
      { taskId: "c" },
    ]);
    expect(hooks.result.current.first.isPending).toBe(true);
  });
  await act(async () => {
    writes.a.resolve({ result: "saved", invalidated: ["tasks"] });
    await reading.promise;
    await a;
  });
  await waitFor(() =>
    expect(hooks.result.current.first.pendingInputs).toEqual([{ taskId: "b" }]),
  );
  await act(async () => {
    writes.b.reject(new Error("Refused"));
    await b;
  });
  await waitFor(() => {
    expect(hooks.result.current.first.pendingInputs).toEqual([]);
    expect(hooks.result.current.first.isPending).toBe(false);
    expect(hooks.result.current.second.pendingInputs).toEqual([
      { taskId: "c" },
    ]);
    expect(hooks.result.current.second.isPending).toBe(true);
  });
  await act(async () => {
    reread.resolve();
    await a;
  });
  await waitFor(() => {
    expect(hooks.result.current.first.pendingInputs).toEqual([]);
    expect(hooks.result.current.first.isPending).toBe(false);
  });
  await act(async () => {
    writes.c.resolve({ result: "saved", invalidated: [] });
    await c;
  });
  await waitFor(() =>
    expect(hooks.result.current.second.pendingInputs).toEqual([]),
  );
  hooks.unmount();
  client.clear();
});

it("commits predictions with the input event without flushing ordinary query notifications", () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  client.setQueryData(["order"], ["Alpha", "Beta"]);
  client.setQueryData(["ordinary"], "unchanged");
  const write = new Promise<TaggedMutationOutcome<void>>(() => {});
  const predict = () => [
    optimisticQueryUpdate<string[]>(["order"], () => ["Beta", "Alpha"]),
  ];
  function Predicted() {
    const query = useTaggedQuery<string[]>(
      { queryKey: ["order"], enabled: false },
      client,
    );
    return createElement("output", null, query.data?.join(","));
  }
  function Ordinary() {
    const query = useQuery<string>(
      { queryKey: ["ordinary"], enabled: false },
      client,
    );
    return createElement("output", null, query.data);
  }
  function Control() {
    const mutation = useTaggedMutation<void, void>({
      client,
      invalidate: async () => {},
      call: () => write,
      optimistic: predict,
    });
    return createElement(
      "button",
      {
        onClick: () => {
          void mutation.mutate(undefined);
          client.setQueryData(["ordinary"], "scheduled");
        },
      },
      "Drop",
    );
  }
  vi.useFakeTimers();
  try {
    const view = render(
      createElement(
        "div",
        null,
        createElement(Predicted),
        createElement(Ordinary),
        createElement(Control),
      ),
    );
    fireEvent.click(view.getByText("Drop"));
    expect(view.getByText("Beta,Alpha")).toBeTruthy();
    expect(view.getByText("unchanged")).toBeTruthy();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(view.getByText("scheduled")).toBeTruthy();
  } finally {
    cleanup();
    client.clear();
    vi.useRealTimers();
  }
});

// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";
import { useTaggedMutation, type TaggedMutationOutcome } from "../src/index.js";

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

it("reports every pending input for its hook until writes and rereads settle", async () => {
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
    first: useTaggedMutation<Input, string>(client, invalidate, call),
    second: useTaggedMutation<Input, string>(client, invalidate, call),
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
  });
  expect(hooks.result.current.first.pendingInputs).toEqual([
    { taskId: "a" },
    { taskId: "b" },
  ]);
  await act(async () => {
    writes.b.reject(new Error("Refused"));
    await b;
  });
  await waitFor(() => {
    expect(hooks.result.current.first.pendingInputs).toEqual([{ taskId: "a" }]);
    expect(hooks.result.current.first.isPending).toBe(true);
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

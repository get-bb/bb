import { describe, expect, it, vi } from "vitest";
import type { NextStep, NextStepInput } from "@bb/domain";
import { createBrowserBbSdk } from "../src/browser.js";
import { createNodeBbSdk } from "../src/node.js";
import type { ThreadsArea } from "../src/areas/threads.js";
import type { FetchImplementation } from "../src/response.js";

const input: NextStepInput = {
  title: "Fix the related failing tests",
  why: "The completed run found related failures.",
  evidence: [{ source: "conversation", ref: "message-1" }],
  action: {
    kind: "task",
    task: { prompt: "Fix the related failing tests", parallel: true },
  },
};

const proposal: NextStep = {
  ...input,
  id: "proposal-1",
  analyticsId: "c2080216-e80b-4310-9868-529952fd3ec4",
  threadId: "thread-1",
  turnId: "turn-1",
  status: "proposed",
  createdAt: 1,
  shownAt: null,
  result: null,
};

const operations = [
  {
    name: "read",
    method: "GET",
    suffix: "",
    body: undefined,
    call: (threads: ThreadsArea) => threads.experimental_nextStep("thread-1"),
  },
  {
    name: "propose",
    method: "POST",
    suffix: "/propose",
    body: { turnId: "turn-1", input },
    call: (threads: ThreadsArea) =>
      threads.experimental_proposeNextStep("thread-1", "turn-1", input),
  },
  {
    name: "shown",
    method: "POST",
    suffix: "/shown",
    body: undefined,
    call: (threads: ThreadsArea) =>
      threads.experimental_showNextStep("thread-1"),
  },
  {
    name: "accept",
    method: "POST",
    suffix: "/accept",
    body: undefined,
    call: (threads: ThreadsArea) =>
      threads.experimental_acceptNextStep("thread-1"),
  },
  {
    name: "dismiss",
    method: "POST",
    suffix: "/dismiss",
    body: undefined,
    call: (threads: ThreadsArea) =>
      threads.experimental_dismissNextStep("thread-1"),
  },
  {
    name: "undo",
    method: "POST",
    suffix: "/undo",
    body: undefined,
    call: (threads: ThreadsArea) =>
      threads.experimental_undoNextStep("thread-1"),
  },
];

describe.each([
  { surface: "browser", createSdk: createBrowserBbSdk },
  { surface: "node", createSdk: createNodeBbSdk },
])("Next step $surface SDK contract", ({ createSdk }) => {
  it.each(operations)(
    "$name uses the shared server route",
    async (operation) => {
      const fetch = vi.fn<FetchImplementation>(async () =>
        Response.json(proposal),
      );
      const sdk = createSdk({ baseUrl: "http://bb.test", fetch });

      await expect(operation.call(sdk.threads)).resolves.toEqual(proposal);

      expect(fetch).toHaveBeenCalledTimes(1);
      const request = fetch.mock.calls[0];
      expect(String(request?.[0])).toBe(
        `http://bb.test/api/v1/threads/thread-1/next-step${operation.suffix}`,
      );
      expect(request?.[1]?.method).toBe(operation.method);
      const body = request?.[1]?.body;
      expect(typeof body === "string" ? JSON.parse(body) : undefined).toEqual(
        operation.body,
      );
    },
  );

  it("preserves absence without manufacturing a proposal", async () => {
    const fetch = vi.fn<FetchImplementation>(async () => Response.json(null));
    const sdk = createSdk({ baseUrl: "http://bb.test", fetch });
    await expect(
      sdk.threads.experimental_nextStep("thread-1"),
    ).resolves.toBeNull();
  });

  it("propagates a rejected action instead of reporting acceptance", async () => {
    const fetch = vi.fn<FetchImplementation>(async () =>
      Response.json({ error: "The next step has expired" }, { status: 409 }),
    );
    const sdk = createSdk({ baseUrl: "http://bb.test", fetch });
    await expect(
      sdk.threads.experimental_acceptNextStep("thread-1"),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

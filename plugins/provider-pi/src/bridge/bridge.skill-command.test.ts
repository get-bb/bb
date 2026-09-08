import { afterEach, beforeEach, expect, it } from "vitest";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

let harness: FakePiBridgeHarness;

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-skill-command-",
    initialize: true,
  });
});

afterEach(async () => {
  await harness.teardown();
});

it("invokes a selected skill through Pi's native command", async () => {
  const threadId = "thr_skill_command";
  await harness.startThread(threadId);

  const response = await harness.request(1, "turn/start", {
    threadId,
    providerThreadId: threadId,
    clientRequestId: "creq_ab23456789",
    input: [
      {
        type: "text",
        text: "/inspect src",
        mentions: [
          {
            start: 0,
            end: "/inspect".length,
            resource: {
              kind: "command",
              trigger: "/",
              name: "inspect",
              source: "skill",
              origin: "user",
              label: "inspect",
              argumentHint: null,
            },
          },
        ],
      },
    ],
    options: FULL_PERMISSION_OPTIONS,
  });

  expect(response.error).toBeUndefined();
  await harness.waitForTurnBoundary(threadId);
  const output = harness
    .deltasOf(threadId)
    .filter((delta) => delta.kind === "item.textDelta")
    .map((delta) => String(delta.text))
    .join("");
  expect(output).toContain("Response to: /skill:inspect src");
});

it("keeps selected provider commands in their displayed form", async () => {
  const threadId = "thr_provider_command";
  await harness.startThread(threadId);

  const response = await harness.request(2, "turn/start", {
    threadId,
    providerThreadId: threadId,
    clientRequestId: "creq_cd23456789",
    input: [
      {
        type: "text",
        text: "/inspect src",
        mentions: [
          {
            start: 0,
            end: "/inspect".length,
            resource: {
              kind: "command",
              trigger: "/",
              name: "inspect",
              source: "command",
              origin: "user",
              label: "inspect",
              argumentHint: null,
            },
          },
        ],
      },
    ],
    options: FULL_PERMISSION_OPTIONS,
  });

  expect(response.error).toBeUndefined();
  await harness.waitForTurnBoundary(threadId);
  const output = harness
    .deltasOf(threadId)
    .filter((delta) => delta.kind === "item.textDelta")
    .map((delta) => String(delta.text))
    .join("");
  expect(output).toContain("Response to: /inspect src");
});

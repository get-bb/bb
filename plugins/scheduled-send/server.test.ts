// Backend tests: what reaches the send route, and the guards that stand
// between a stale clock and a message that sends itself immediately.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { MAX_SCHEDULE_AHEAD_MS } from "./schedule-time";

const PLUGIN_ID = "scheduled-send";
const NOW = new Date(2026, 7, 25, 12, 0, 0, 0).getTime();
const IN_AN_HOUR = NOW + 60 * 60 * 1000;

async function loadPlugin(
  send: (args: unknown) => unknown = () => ({ ok: true, delivery: "held" }),
) {
  const sendSpy = vi.fn(send);
  const host = createFakePluginHost({
    pluginId: PLUGIN_ID,
    sdk: { threads: { send: sendSpy } },
  });
  await plugin(host.bb);
  return { host, sendSpy };
}

afterEach(() => {
  vi.useRealTimers();
});

function freezeClock(): void {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
}

describe("scheduleSend", () => {
  it("sends the draft with holdUntil and reports the held delivery", async () => {
    freezeClock();
    const { host, sendSpy } = await loadPlugin();

    const result = await host.harness.callRpc("scheduleSend", {
      threadId: "thr_1",
      text: "ship the release notes",
      holdUntil: IN_AN_HOUR,
    });

    expect(sendSpy).toHaveBeenCalledWith({
      threadId: "thr_1",
      mode: "auto",
      input: [{ type: "text", text: "ship the release notes", mentions: [] }],
      holdUntil: IN_AN_HOUR,
    });
    expect(result).toEqual({ delivery: "held", holdUntil: IN_AN_HOUR });
  });

  it("rejects a time that has already passed without sending", async () => {
    freezeClock();
    const { host, sendSpy } = await loadPlugin();

    // The frontend parsed against a clock the user then ignored for a while.
    // The route would accept this and the sweep would release it at once,
    // sending a message the user believes is scheduled.
    await expect(
      host.harness.callRpc("scheduleSend", {
        threadId: "thr_1",
        text: "hello",
        holdUntil: NOW - 1,
      }),
    ).rejects.toThrow(/already passed/);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("rejects the current instant, which the route would treat as due", async () => {
    freezeClock();
    const { host, sendSpy } = await loadPlugin();

    await expect(
      host.harness.callRpc("scheduleSend", {
        threadId: "thr_1",
        text: "hello",
        holdUntil: NOW,
      }),
    ).rejects.toThrow(/already passed/);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("rejects a schedule further out than a year", async () => {
    freezeClock();
    const { host, sendSpy } = await loadPlugin();

    await expect(
      host.harness.callRpc("scheduleSend", {
        threadId: "thr_1",
        text: "hello",
        holdUntil: NOW + MAX_SCHEDULE_AHEAD_MS + 1,
      }),
    ).rejects.toThrow(/within the next year/);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("warns when a server sent instead of holding", async () => {
    freezeClock();
    // A build without holdUntil support ignores the field and delivers now.
    // The message is already gone; the user must not be told it is scheduled.
    const { host } = await loadPlugin(() => ({ ok: true, delivery: "sent" }));

    const result = await host.harness.callRpc("scheduleSend", {
      threadId: "thr_1",
      text: "hello",
      holdUntil: IN_AN_HOUR,
    });

    expect(result).toEqual({ delivery: "sent", holdUntil: IN_AN_HOUR });
    expect(
      host.harness.logEntries.some(
        (entry) => entry.level === "warn" && entry.message.includes('"sent"'),
      ),
    ).toBe(true);
  });

  it("rejects an empty draft at the contract boundary", async () => {
    freezeClock();
    const { host, sendSpy } = await loadPlugin();

    await expect(
      host.harness.callRpc("scheduleSend", {
        threadId: "thr_1",
        text: "",
        holdUntil: IN_AN_HOUR,
      }),
    ).rejects.toThrow();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";
import { HandoffBanner } from "./app.js";
import { handoffContract, type HandoffOffer } from "./src/handoff.js";

const THREAD_ID = "thr_limited";

const OFFER: HandoffOffer = {
  threadId: THREAD_ID,
  continuedIn: null,
  from: { id: "claude-code", name: "Claude Code" },
  to: { id: "codex", name: "Codex" },
  retryAt: null,
};

afterEach(() => {
  cleanup();
});

function renderBanner(offer: HandoffOffer | null) {
  return renderSlot(
    { component: HandoffBanner },
    {},
    {
      composer: { scope: { kind: "thread", threadId: THREAD_ID } },
      experimental_rpcContract: handoffContract,
      rpc: {
        "handoff.get": () => offer,
        "handoff.start": () => ({ threadId: "thr_continued" }),
      },
    },
  );
}

describe("usage limit handoff banner", () => {
  it("continues in the fallback provider and opens the new thread", async () => {
    const slot = renderBanner(OFFER);

    const banner = await screen.findByRole("status");
    expect(banner.textContent).toContain("Claude Code usage limit");
    expect(banner.textContent).toContain("No automatic retry");
    fireEvent.click(screen.getByRole("button", { name: "Continue in Codex" }));

    await expect
      .poll(() => slot.inspection.navigateCalls)
      .toEqual([{ method: "toThread", threadId: "thr_continued" }]);
    expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain(
      "handoff.start",
    );
  });

  it("links the thread that already continues the work", async () => {
    const slot = renderBanner({ ...OFFER, continuedIn: "thr_continued" });

    const banner = await screen.findByRole("status");
    expect(banner.textContent).toContain("Continued in Codex");
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toThread", threadId: "thr_continued" },
    ]);
    expect(slot.inspection.rpcCalls.map((call) => call.method)).not.toContain(
      "handoff.start",
    );
  });

  it("shows nothing when the thread has no handoff", async () => {
    const slot = renderBanner(null);

    await expect.poll(() => slot.inspection.rpcCalls.length).toBeGreaterThan(0);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

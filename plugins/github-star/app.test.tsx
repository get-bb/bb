// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Toaster, toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { IDLE_MS, REPOSITORY_URL } from "./app";

const app = await loadPluginApp(() => import("./app"));

type Outcome = "show" | "wait" | "done";

function mountPrompt(outcomes: Outcome[]) {
  const Prompt = app.appOverlays[0]!.component;
  return renderSlot(
    {
      component: () => (
        <>
          <Prompt />
          <Toaster />
        </>
      ),
    },
    {},
    { rpc: { claim: () => ({ outcome: outcomes.shift() ?? "done" }) } },
  );
}

async function idle(ms = IDLE_MS): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}

describe("GitHub Star prompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    toast.dismiss();
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks the server only after the window has been idle", async () => {
    const slot = mountPrompt(["show"]);
    await idle(IDLE_MS - 1_000);
    fireEvent.keyDown(window);
    await idle(IDLE_MS - 1_000);
    expect(slot.rpcCalls).toEqual([]);

    await idle(1_000);
    expect(slot.rpcCalls).toEqual([{ method: "claim", input: null }]);
    expect(screen.getByText("Enjoying bb?")).toBeTruthy();
  });

  it("shows only the star link and a close button, and opens the repository", async () => {
    const slot = mountPrompt(["show"]);
    await idle();

    const toast = screen.getByText("Enjoying bb?").closest("[data-bb-plugin]");
    expect(toast?.getAttribute("data-bb-plugin")).toBe("test-plugin");
    expect(toast?.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe(
      "GithubLogo",
    );
    expect(
      screen
        .getAllByRole("button")
        .map(
          (button) => button.getAttribute("aria-label") ?? button.textContent,
        ),
    ).toEqual(["Star on GitHub", "Dismiss"]);

    fireEvent.click(screen.getByRole("button", { name: "Star on GitHub" }));
    expect(slot.navigateCalls).toEqual([
      { method: "openUrl", url: REPOSITORY_URL },
    ]);
  });

  it("checks again after the next activity while too few prompts were sent", async () => {
    const slot = mountPrompt(["wait", "show"]);
    await idle();
    await idle(IDLE_MS * 3);
    expect(slot.rpcCalls).toHaveLength(1);

    fireEvent.pointerDown(window);
    await idle();
    expect(slot.rpcCalls).toHaveLength(2);
    expect(screen.getByText("Enjoying bb?")).toBeTruthy();
  });

  it("stops for good once the server says it already asked", async () => {
    const slot = mountPrompt(["done"]);
    await idle();
    fireEvent.pointerDown(window);
    await idle(IDLE_MS * 3);

    expect(slot.rpcCalls).toHaveLength(1);
    expect(screen.queryByText("Enjoying bb?")).toBeNull();
  });
});

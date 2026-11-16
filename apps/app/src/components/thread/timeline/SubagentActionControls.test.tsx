// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { delegationRow } from "@/test/fixtures/thread-timeline-rows";
import { sdk } from "@/lib/sdk";
import { SubagentActionControls } from "./SubagentActionControls.js";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      subagents: {
        tell: vi.fn(),
        cancel: vi.fn(),
      },
    },
  },
}));

const tell = vi.mocked(sdk.threads.subagents.tell);
const cancel = vi.mocked(sdk.threads.subagents.cancel);

afterEach(() => {
  cleanup();
  tell.mockReset();
  cancel.mockReset();
});

describe("SubagentActionControls", () => {
  it("sends exact text and cancellation to the stable childRef", async () => {
    tell.mockResolvedValue({ childRef: "child-1", messageId: "message-1" });
    cancel.mockResolvedValue({ childRef: "child-1", status: "cancelled" });
    const row = delegationRow({
      childRef: "child-1",
      status: "pending",
      threadId: "thr_1",
    });
    const text = "Hello 😀 مراجعة";
    render(<SubagentActionControls row={row} />);

    fireEvent.change(
      screen.getByRole("textbox", { name: "Message subagent child-1" }),
      { target: { value: text } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Message" }));
    await waitFor(() =>
      expect(tell).toHaveBeenCalledWith({
        threadId: "thr_1",
        childRef: "child-1",
        text,
      }),
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Message message-1 accepted",
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel subagent" }));
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({
        threadId: "thr_1",
        childRef: "child-1",
      }),
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Subagent child-1 cancelled",
    );
  });

  it("hides actions without a stable child identity", () => {
    render(
      <SubagentActionControls
        row={delegationRow({ childRef: null, status: "pending" })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Message" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Cancel subagent" }),
    ).toBeNull();
  });

  it("disables message and cancellation for a settled child", () => {
    render(
      <SubagentActionControls
        row={delegationRow({ childRef: "child-1", status: "completed" })}
      />,
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Message subagent child-1" }),
      { target: { value: "Do not send" } },
    );
    expect(screen.getByRole("button", { name: "Message" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByRole("button", { name: "Cancel subagent" }),
    ).toHaveProperty("disabled", true);
  });
});

// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageActionBar } from "./MessageActionBar";

afterEach(cleanup);

describe("MessageActionBar", () => {
  it("send-to-main is not gated by the fork/side-chat depth `disabled` flag", () => {
    const onSendToMain = vi.fn();
    render(
      <MessageActionBar
        messageText="An answer."
        alignment="start"
        onSendToMain={onSendToMain}
        disabled
      />,
    );

    const button = screen.getByRole("button", { name: "Send to main thread" });
    expect(button.hasAttribute("disabled")).toBe(false);
  });
});

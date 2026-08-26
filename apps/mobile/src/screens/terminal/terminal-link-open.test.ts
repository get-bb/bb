import { describe, expect, it, vi } from "vitest";
import { requestTerminalLinkOpen } from "./terminal-link-open";

describe("requestTerminalLinkOpen", () => {
  it("discloses the exact target and opens it only after confirmation", () => {
    const url = "https://example.com/hidden-osc-8-target";
    const openUrl = vi.fn();
    let confirmRequest:
      | Parameters<Parameters<typeof requestTerminalLinkOpen>[0]["confirm"]>[0]
      | undefined;

    requestTerminalLinkOpen({
      confirm: (request) => {
        confirmRequest = request;
      },
      openUrl,
      source: "osc8",
      url,
    });

    expect(confirmRequest).toMatchObject({
      actionLabel: "Open",
      message: url,
      title: "Open terminal link?",
    });
    expect(openUrl).not.toHaveBeenCalled();

    confirmRequest?.onConfirm();

    expect(openUrl).toHaveBeenCalledOnce();
    expect(openUrl).toHaveBeenCalledWith(url);
  });

  it("opens a visible URL without confirmation", () => {
    const confirm = vi.fn();
    const openUrl = vi.fn();
    const url = "https://example.com/visible-target";

    requestTerminalLinkOpen({
      confirm,
      openUrl,
      source: "detected-url",
      url,
    });

    expect(openUrl).toHaveBeenCalledOnce();
    expect(openUrl).toHaveBeenCalledWith(url);
    expect(confirm).not.toHaveBeenCalled();
  });
});

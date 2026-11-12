import { describe, expect, it, vi } from "vitest";
import {
  automationDetailUrl,
  copyAutomationDetailLink,
} from "./automation-link.js";

describe("automation links", () => {
  it("builds stable detail URLs without a suffix, query or hash", () => {
    const url = automationDetailUrl("https://bb.example", "proj_1", "auto_1");
    expect(url).toBe(
      "https://bb.example/plugins/automations/automations/proj_1/auto_1",
    );
    expect(automationDetailUrl("https://bb.example", "proj_1", "auto_1")).toBe(
      url,
    );
    expect(
      automationDetailUrl("https://bb.example", "proj_personal", "auto_a-b_c"),
    ).toBe(
      "https://bb.example/plugins/automations/automations/proj_personal/auto_a-b_c",
    );
    expect(url).not.toMatch(/\/edit|[?#]/);
  });

  it("handles invalid origins without copying", async () => {
    const copy = vi.fn();
    const notify = { success: vi.fn(), error: vi.fn() };
    expect(() => automationDetailUrl("invalid", "proj_1", "auto_1")).toThrow(
      TypeError,
    );
    await copyAutomationDetailLink("invalid", "proj_1", "auto_1", copy, notify);
    expect(copy).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledExactlyOnceWith(
      "Could not copy the link",
    );
    expect(notify.success).not.toHaveBeenCalled();
  });

  it("allows a successful retry after a failed copy", async () => {
    const copy = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const notify = { success: vi.fn(), error: vi.fn() };
    await copyAutomationDetailLink(
      "https://bb.example",
      "proj_1",
      "auto_1",
      copy,
      notify,
    );
    expect(notify.error).toHaveBeenCalledExactlyOnceWith(
      "Could not copy the link",
    );
    expect(notify.success).not.toHaveBeenCalled();
    await copyAutomationDetailLink(
      "https://bb.example",
      "proj_1",
      "auto_1",
      copy,
      notify,
    );
    expect(copy.mock.calls[0]).toEqual(copy.mock.calls[1]);
    expect(notify.success).toHaveBeenCalledExactlyOnceWith("Link copied");
  });

  it("handles clipboard rejection without exposing the error", async () => {
    const notify = { success: vi.fn(), error: vi.fn() };
    await expect(
      copyAutomationDetailLink(
        "https://bb.example",
        "proj_1",
        "auto_1",
        vi.fn().mockRejectedValue(new Error("private")),
        notify,
      ),
    ).resolves.toBeUndefined();
    expect(notify.error).toHaveBeenCalledExactlyOnceWith(
      "Could not copy the link",
    );
    expect(notify.success).not.toHaveBeenCalled();
  });
});

import { createApplicationLinkApprovals } from "../src/application-link-approvals.js";
import { describe, expect, it, vi } from "vitest";
import {
  createApplicationUrlOpener,
  type ApplicationUrlDecision,
} from "../src/application-url.js";

describe("application links", () => {
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,test",
    "file:///Applications/Calculator.app",
    "ms-msdt:/id",
    "search-ms:query=test",
    "ms-appinstaller://test",
    "ms-officecmd:test",
    "vbscript:test",
    "shell:test",
    "smb://server/share",
    "blob:https://example.com/id",
    "chrome://settings",
    "vscode://command/workbench.action.terminal.new",
    "devin://chat-plugin/install",
    "linear://user:password@issue/123",
    "linear://issue/%00test",
    "linear://issue/%0Atest",
    " linear://issue/123",
    "linear:\n//issue/123",
    "/some/file",
    "bb://settings",
  ])("rejects %s before prompting", async (url) => {
    const confirm = vi.fn();
    const open = vi.fn();
    const opener = createApplicationUrlOpener({
      confirm,
      open,
    });
    await expect(opener(url)).rejects.toThrow("blocked or invalid");
    expect(open).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each([
    ["linear://issue/ABC-123", "linear"],
    ["reflect://note/Project%20X?tag=a%2Fb#section", "reflect"],
    ["things:///show?id=abc", "things"],
    ["LINEAR://issue/ABC-123", "linear"],
  ])(
    "preserves %s and asks again after one-time approval",
    async (url, scheme) => {
      const confirm = vi.fn(
        async (): Promise<ApplicationUrlDecision> => "open",
      );
      const open = vi.fn();
      const opener = createApplicationUrlOpener({
        confirm,
        open,
      });
      expect(open).not.toHaveBeenCalled();
      await opener(url);
      await opener(url);
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(confirm).toHaveBeenCalledWith({ url, scheme });
      expect(open.mock.calls).toEqual([[url], [url]]);
    },
  );

  it("cancellation never launches the destination", async () => {
    const open = vi.fn();
    const opener = createApplicationUrlOpener({
      confirm: async () => "cancel",
      open,
    });
    await opener("linear://issue/123");
    expect(open).not.toHaveBeenCalled();
  });

  it("reports failed launches and allows another attempt", async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error("No application installed"))
      .mockResolvedValue(undefined);
    const confirm = vi.fn(async (): Promise<ApplicationUrlDecision> => "open");
    const opener = createApplicationUrlOpener({
      confirm,
      open,
    });
    await expect(opener("linear://issue/123")).rejects.toThrow(
      "No application installed",
    );
    await opener("linear://issue/123");
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("does not stack confirmations or launch a second URL while approval is pending", async () => {
    let settle: (decision: ApplicationUrlDecision) => void = () => {};
    const confirm = vi.fn(
      () =>
        new Promise<ApplicationUrlDecision>((resolve) => {
          settle = resolve;
        }),
    );
    const open = vi.fn();
    const opener = createApplicationUrlOpener({
      confirm,
      open,
    });
    const first = opener("linear://issue/123");
    await opener("reflect://note/test");
    expect(confirm).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    settle("open");
    await first;
    expect(open.mock.calls).toEqual([["linear://issue/123"]]);
  });
});

describe("remembered application approvals", () => {
  function storage() {
    let value: string | null = null;
    return {
      read: () => value,
      write: (next: string) => {
        value = next;
      },
    };
  }

  it("persists by scheme, scopes other apps, and asks again after one or all approvals are revoked", async () => {
    const disk = storage();
    const approvals = createApplicationLinkApprovals(disk);
    const confirm = vi.fn(
      async (): Promise<ApplicationUrlDecision> => "always",
    );
    const open = vi.fn();
    await createApplicationUrlOpener({ approvals, confirm, open })(
      "LINEAR://issue/1",
    );
    const reloaded = createApplicationLinkApprovals(disk);
    const opener = createApplicationUrlOpener({
      approvals: reloaded,
      confirm,
      open,
    });
    await opener("linear://issue/2");
    expect(confirm).toHaveBeenCalledTimes(1);
    await opener("reflect://note/test");
    expect(confirm).toHaveBeenCalledTimes(2);
    reloaded.revoke("linear");
    await opener("linear://issue/3");
    expect(confirm).toHaveBeenCalledTimes(3);
    reloaded.revoke(null);
    await opener("reflect://note/test");
    expect(confirm).toHaveBeenCalledTimes(4);
    expect(open).toHaveBeenCalledTimes(5);
  });

  it("does not remember cancelled or failed launches", async () => {
    const approvals = createApplicationLinkApprovals(storage());
    const open = vi.fn().mockRejectedValue(new Error("Missing app"));
    const confirm = vi.fn(
      async (): Promise<ApplicationUrlDecision> => "always",
    );
    confirm.mockResolvedValueOnce("cancel");
    const opener = createApplicationUrlOpener({ approvals, confirm, open });
    await opener("linear://issue/1");
    expect(approvals.list()).toEqual([]);
    await expect(opener("linear://issue/1")).rejects.toThrow("Missing app");
    expect(approvals.list()).toEqual([]);
    await expect(opener("linear://issue/2")).rejects.toThrow("Missing app");
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("does not restore a grant after revocation while an app launch is pending", async () => {
    const approvals = createApplicationLinkApprovals(storage());
    let finish: () => void = () => {};
    const launched = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const opener = createApplicationUrlOpener({
      approvals,
      confirm: async () => "always",
      open: () => launched,
    });
    const pending = opener("linear://issue/1");
    approvals.revoke(null);
    finish();
    await pending;
    expect(approvals.list()).toEqual([]);
  });

  it.each([
    "not json",
    '{"revision":0,"schemes":["javascript"]}',
    '{"revision":0,"schemes":["LINEAR"]}',
  ])("fails closed for corrupt persisted approvals: %s", async (raw) => {
    const approvals = createApplicationLinkApprovals({
      read: () => raw,
      write: () => {},
    });
    const confirm = vi.fn(
      async (): Promise<ApplicationUrlDecision> => "cancel",
    );
    const open = vi.fn();
    const opener = createApplicationUrlOpener({ approvals, confirm, open });
    await opener("linear://issue/1");
    await expect(opener("javascript:alert(1)")).rejects.toThrow(
      "blocked or invalid",
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });
});

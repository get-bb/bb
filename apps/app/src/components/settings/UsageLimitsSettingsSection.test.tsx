// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageLimitsSettingsSectionContent } from "./UsageLimitsSettingsSection";

const primaryHost: Host = {
  id: "host-primary",
  name: "MacBook Pro",
  type: "persistent",
  status: "connected",
  lastSeenAt: 1,
  maxPermissionMode: "full",
  lastRejectedProtocolVersion: null,
  createdAt: 1,
  updatedAt: 1,
};

const remoteHost: Host = {
  ...primaryHost,
  id: "host-remote",
  name: "Build machine",
};

afterEach(cleanup);

function renderContent(
  props: ComponentProps<typeof UsageLimitsSettingsSectionContent>,
) {
  return render(
    <TooltipProvider>
      <UsageLimitsSettingsSectionContent {...props} />
    </TooltipProvider>,
  );
}

describe("UsageLimitsSettingsSectionContent", () => {
  it("renders Cursor plan and on-demand limits", () => {
    renderContent({
      usage: {
        "acp-cursor": {
          status: "ok",
          accountEmail: "cursor@example.com",
          planLabel: "Pro",
          windows: [
            { label: "Plan usage", usedPercent: 50, resetsAt: null },
            {
              label: "On-demand spend",
              usedPercent: 10,
              resetsAt: null,
              cost: { usedUsdCents: 500, limitUsdCents: 5_000 },
            },
          ],
        },
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      onRefresh: vi.fn(),
    });

    expect(screen.getByRole("heading", { name: "Cursor" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Cursor" })).toBeDefined();
    expect(screen.getByText("cursor@example.com")).toBeDefined();
    expect(screen.getByText("Plan usage")).toBeDefined();
    expect(screen.getByText("50% used")).toBeDefined();
    expect(screen.getByText("On-demand spend")).toBeDefined();
    expect(screen.getByText("$5.00 / $50")).toBeDefined();
  });

  it("hides Cursor when its CLI is not installed", () => {
    renderContent({
      usage: {
        codex: { status: "unauthenticated" },
        "acp-cursor": { status: "not_installed" },
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      onRefresh: vi.fn(),
    });

    expect(screen.queryByRole("heading", { name: "Cursor" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Codex" })).toBeDefined();
  });

  it("keeps states without usage bars with the provider heading", () => {
    renderContent({
      usage: { codex: { status: "unauthenticated" } },
      isLoading: false,
      isError: false,
      isFetching: false,
      onRefresh: vi.fn(),
    });

    const heading = screen.getByRole("heading", { name: "Codex" });
    const status = screen.getByText(/Run `codex` to sign in/u);
    expect(heading.parentElement?.contains(status)).toBe(true);
  });

  it("selects which connected machine supplies usage", () => {
    const onSelectHost = vi.fn();
    renderContent({
      usage: {},
      isLoading: false,
      isError: false,
      isFetching: false,
      onRefresh: vi.fn(),
      hosts: [primaryHost, remoteHost],
      selectedHostId: primaryHost.id,
      onSelectHost,
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Usage limits machine" }),
      { button: 0 },
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Build machine/u }));

    expect(onSelectHost).toHaveBeenCalledWith(remoteHost.id);
  });

  it("does not show a machine selector when there is only one machine", () => {
    renderContent({
      usage: {},
      isLoading: false,
      isError: false,
      isFetching: false,
      onRefresh: vi.fn(),
      hosts: [primaryHost],
      selectedHostId: primaryHost.id,
      onSelectHost: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: "Usage limits machine" }),
    ).toBeNull();
  });
});

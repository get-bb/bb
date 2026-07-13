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

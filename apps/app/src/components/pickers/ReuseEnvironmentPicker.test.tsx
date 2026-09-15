// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReuseThreadOption } from "@/components/pickers/reuse-environment/reuse-options";
import { ReuseEnvironmentPicker } from "@/components/pickers/ReuseEnvironmentPicker";

vi.mock("@/hooks/queries/environment-provider-queries", () => ({
  useSystemEnvironmentProviders: () => ({ providers: [] }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const discovered: ReuseThreadOption = {
  value: "path:host_1:%2Fworktrees%2Fspike",
  environmentId: null,
  branchName: "spike",
  name: null,
  path: "/worktrees/spike",
  environmentProviderId: null,
  hostId: "host_1",
  hostName: null,
  worktree: {
    detachedHeadSha: null,
    lock: { reason: "on removable drive" },
    unavailableReason: null,
    userManaged: true,
  },
  threads: [],
};

const stale: ReuseThreadOption = {
  ...discovered,
  value: null,
  branchName: "stale",
  path: "/worktrees/stale",
  worktree: { ...discovered.worktree!, lock: null, unavailableReason: "missing" },
};

function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Environment" }), {
    button: 0,
  });
}

describe("ReuseEnvironmentPicker", () => {
  it("selects a discovered worktree by its encoded value and keeps stale rows disabled", () => {
    const onChange = vi.fn();
    render(
      <ReuseEnvironmentPicker
        options={[discovered, stale]}
        failures={[]}
        value={null}
        onChange={onChange}
        modal={false}
      />,
    );
    openMenu();
    const staleRow = screen.getByRole("menuitem", { name: /stale/u });
    expect(staleRow.getAttribute("aria-disabled")).toBe("true");
    expect(staleRow.textContent).toContain("Directory is missing.");

    const spikeRow = screen.getByRole("menuitem", { name: /spike/u });
    expect(spikeRow.textContent).toContain("User-managed");
    expect(spikeRow.textContent).toContain("Locked: on removable drive");
    fireEvent.click(spikeRow);
    expect(onChange).toHaveBeenCalledWith(discovered.value);
  });

  it("lists a machine's discovery failure with a retry action", () => {
    const onRetry = vi.fn();
    render(
      <ReuseEnvironmentPicker
        options={[]}
        failures={[
          { hostId: "host_2", hostName: "Desktop", message: "Machine is offline" },
        ]}
        value={null}
        onChange={vi.fn()}
        onRetry={onRetry}
        modal={false}
      />,
    );
    openMenu();
    expect(screen.getByText("Desktop: Machine is offline")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("explains an empty list while discovery is still running", () => {
    render(
      <ReuseEnvironmentPicker
        options={[]}
        failures={[]}
        value={null}
        onChange={vi.fn()}
        loading
        modal={false}
      />,
    );
    openMenu();
    expect(screen.getByText("Discovering worktrees…")).toBeTruthy();
  });
});

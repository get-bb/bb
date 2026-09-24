// @vitest-environment jsdom
// bb-fork(parent-mute): fork-owned coverage for the Parent row mute toggle
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeThread as makeThreadFixture } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParentSelectorRow } from "./ThreadMetadataContent";

afterEach(() => {
  cleanup();
});

function renderRow(args: {
  mutedAt: number | null;
  onMuteChange?: (next: boolean) => void;
}) {
  const thread = makeThreadFixture({
    id: "thr_child",
    projectId: "proj_bb",
    parentThreadId: "thr_parent",
    parentNotificationsMutedAt: args.mutedAt,
  });
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ParentSelectorRow
          thread={thread}
          projectId="proj_bb"
          parentThreadProjectId={null}
          parentThreadDisplayName="Manager"
          parentThreads={[]}
          canAssignToParent={false}
          canTakeOverThread
          isLoadingParentThreads={false}
          isParentThreadsError={false}
          updateThreadPending={false}
          onAssignParent={vi.fn()}
          onParentSelectorOpenChange={vi.fn()}
          onRetryParentThreads={vi.fn()}
          {...(args.onMuteChange
            ? { onParentNotificationsMutedChange: args.onMuteChange }
            : {})}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("ParentSelectorRow parent notification mute", () => {
  it("offers no mute control without a handler", () => {
    renderRow({ mutedAt: null });
    expect(screen.queryByLabelText("Mute parent notifications")).toBeNull();
  });

  it("mutes an unmuted child", () => {
    const onMuteChange = vi.fn();
    renderRow({ mutedAt: null, onMuteChange });
    const toggle = screen.getByLabelText("Mute parent notifications");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(onMuteChange).toHaveBeenCalledWith(true);
  });

  it("unmutes a muted child", () => {
    const onMuteChange = vi.fn();
    renderRow({ mutedAt: 1_700_000_000_000, onMuteChange });
    const toggle = screen.getByLabelText("Unmute parent notifications");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(onMuteChange).toHaveBeenCalledWith(false);
  });
});

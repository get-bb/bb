// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Host } from "@bb/domain";
import { MachineRenameDialog } from "./MachineRenameDialog";

afterEach(cleanup);

describe("MachineRenameDialog", () => {
  it("makes a rename failure its own Select All scope", () => {
    const target: Host = {
      id: "host_1",
      name: "workstation",
      type: "persistent",
      status: "connected",
      maxPermissionMode: "full",
      lastSeenAt: Date.now(),
      lastRejectedProtocolVersion: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    render(
      <MachineRenameDialog
        target={target}
        pending={false}
        errorMessage="Rename failed with code 409"
        onOpenChange={vi.fn()}
        onRename={vi.fn()}
      />,
    );

    expect(
      screen
        .getByText("Rename failed with code 409")
        .closest("[data-select-all-scope]"),
    ).not.toBeNull();
  });
});

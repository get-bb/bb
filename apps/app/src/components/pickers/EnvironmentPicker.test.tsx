// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { Host, ProjectSource } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentPickerUI } from "./EnvironmentPicker";

const host: Host = {
  id: "host_remote",
  name: "studio-mac-mini",
  type: "persistent",
  status: "connected",
  lastSeenAt: 0,
  createdAt: 0,
  updatedAt: 0,
};

const sources: readonly ProjectSource[] = [
  {
    id: "src_remote",
    projectId: "proj_bb",
    type: "local_path",
    hostId: host.id,
    path: "/Users/michael/Projects/bb",
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  },
];

afterEach(() => {
  cleanup();
});

describe("EnvironmentPickerUI", () => {
  it("uses Remote as the compact label for remote direct work", () => {
    render(
      <EnvironmentPickerUI
        value={`host:${host.id}:local`}
        onChange={vi.fn()}
        sources={sources}
        host={host}
        isLocal={false}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Environment" });
    const compactLabel = trigger.querySelector(
      "[data-promptbox-compact-label]",
    );

    if (compactLabel === null) {
      throw new Error("Missing compact environment label");
    }

    expect(trigger.textContent).toContain("Work remotely");
    expect(compactLabel.textContent).toBe("Remote");
  });
});

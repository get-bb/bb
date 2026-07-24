// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectPathDialog } from "./ProjectPathDialog";

vi.mock("@/components/dialogs/RemotePathBrowser", () => ({
  RemotePathBrowser: ({
    hostId,
    onDirectoryChange,
  }: {
    hostId: string;
    onDirectoryChange: (directory: string) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onDirectoryChange(
          hostId === "host_kunst"
            ? "/Users/amadad/projects/reachy_mini"
            : "/home/deploy/repos/givecare",
        )
      }
    >
      Choose folder on {hostId}
    </button>
  ),
}));

function host(overrides: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    type: "persistent",
    status: "connected",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const atum = host({ id: "host_atum", name: "atum" });
const kunst = host({ id: "host_kunst", name: "Kunst" });
const offline = host({
  id: "host_offline",
  name: "Offline Mac",
  status: "disconnected",
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectPathDialog machine selection", () => {
  it("creates a project from a folder on the selected connected machine", () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum, kunst, offline]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(
      (screen.getByRole("radio", { name: "atum" }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      screen
        .getByRole("radio", { name: "Offline Mac" })
        .hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Kunst" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_kunst" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(onSubmit).toHaveBeenCalledWith(
      { kind: "create" },
      "/Users/amadad/projects/reachy_mini",
      "host_kunst",
    );
  });

  it("preserves the direct single-machine folder flow", () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByRole("radiogroup", { name: "Machine" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_atum" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(onSubmit).toHaveBeenCalledWith(
      { kind: "create" },
      "/home/deploy/repos/givecare",
      "host_atum",
    );
  });
});

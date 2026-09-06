// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProjectSource } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentPickerUI } from "./EnvironmentPicker";

const localHost = makeHost({ id: "host_local", name: "Local machine" });
const remoteHost = makeHost({ id: "host_remote", name: "Remote machine" });
const sources: readonly ProjectSource[] = [
  {
    id: "src_local",
    projectId: "proj_test",
    type: "local_path",
    hostId: localHost.id,
    path: "/tmp/local-project",
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "src_remote",
    projectId: "proj_test",
    type: "local_path",
    hostId: remoteHost.id,
    path: "/tmp/remote-project",
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
  },
];

afterEach(cleanup);

describe("EnvironmentPickerUI workspace mode", () => {
  it("labels a selected checkout by workspace mode", () => {
    render(
      <EnvironmentPickerUI
        value={`host:${remoteHost.id}:local`}
        onChange={vi.fn()}
        sources={sources}
        host={remoteHost}
        isLocal={false}
        machines={{
          hosts: [localHost, remoteHost],
          localDaemonHostId: localHost.id,
          primaryHostId: localHost.id,
        }}
        modal={false}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    expect({
      triggerLabel: document.querySelector("[data-promptbox-full-label]")
        ?.textContent,
      compactLabel: document.querySelector("[data-promptbox-compact-label]")
        ?.textContent,
      selectedCheckoutLabel: screen
        .getByRole("menuitem", { name: /\/tmp\/remote-project/u })
        .querySelector("span span")?.textContent,
    }).toEqual({
      triggerLabel: "Remote machine · Current checkout",
      compactLabel: "Checkout",
      selectedCheckoutLabel: "Current checkout",
    });
  });
});

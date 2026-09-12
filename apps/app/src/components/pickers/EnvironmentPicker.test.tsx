// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Host, ProjectSource } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EnvironmentPickerUI,
  PROVIDER_INPUTS_CONTROL_MISSING_REASON,
} from "./EnvironmentPicker";

const checkoutProvider: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "project-checkout",
  displayName: "Project checkout",
  description: "Work in this project checkout.",
  icon: "Laptop",
  logoUrl: null,
  pluginId: "environment-project-checkout",
  acceptsEmptyInputs: true,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: true,
    gitCheckout: false,
    gitRemote: false,
    projectless: false,
  },
  inputs: null,
};

const branchProvider: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "branchy",
  displayName: "New branch workspace",
  description: "Prepare a workspace for this thread.",
  icon: "GitBranch",
  logoUrl: null,
  pluginId: "branchy",
  acceptsEmptyInputs: true,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: true,
    gitCheckout: true,
    gitRemote: false,
    projectless: false,
  },
  inputs: null,
};

const sandboxProvider: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "container",
  displayName: "Docker container",
  description: "Prepare a workspace for this thread.",
  icon: "Container",
  logoUrl: null,
  pluginId: "docker-sandbox",
  acceptsEmptyInputs: false,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: false,
    gitCheckout: false,
    gitRemote: false,
    projectless: false,
  },
  inputs: {
    type: "object",
    properties: { image: { type: "string" } },
    required: ["image"],
  },
};

const optionalInputsProvider: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "optional-sandbox",
  displayName: "Optional sandbox",
  description: "Prepare a workspace for this thread.",
  icon: "Container",
  logoUrl: null,
  pluginId: "optional-sandbox",
  acceptsEmptyInputs: true,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: false,
    gitCheckout: false,
    gitRemote: false,
    projectless: false,
  },
  inputs: {
    type: "object",
    properties: { image: { type: "string" } },
  },
};

const host = makeHost({
  id: "host_test",
  name: "Local host",
});

const sources: readonly ProjectSource[] = [
  {
    id: "src_test",
    projectId: "proj_test",
    type: "local_path",
    hostId: host.id,
    path: "/tmp/project",
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPicker(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("EnvironmentPickerUI", () => {
  it("does not expose an ephemeral host through the single-machine fallback", () => {
    const ephemeralHost: Host = {
      ...host,
      name: "Modal sandbox 3f9a",
      type: "ephemeral",
      machineProviderId: "modal-sandbox",
    };
    renderPicker(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={sources}
        host={ephemeralHost}
        isLocal={false}
        providers={[checkoutProvider]}
        onSelectProvider={vi.fn()}
        modal={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });
    expect(screen.queryByText(ephemeralHost.name)).toBeNull();
    expect(
      screen.getByRole("option", { name: "No host connected" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: /Project checkout/u }),
    ).toBeNull();
  });

  it.each([false, true])(
    "shows loading instead of empty options (multiple machines: %s)",
    (multipleMachines) => {
      const props = {
        value: "provider:project-checkout",
        sources: [],
        host,
        isLocal: true,
        machines: multipleMachines
          ? {
              hosts: [host, makeHost({ id: "host_second" })],
              localDaemonHostId: host.id,
              primaryHostId: host.id,
            }
          : null,
        onSelectProvider: vi.fn(),
        modal: false,
      };
      const { rerender } = render(<EnvironmentPickerUI {...props} isLoading />);
      const trigger = screen.getByRole("button", {
        name: "Environment",
      });
      expect(trigger.getAttribute("aria-busy")).toBe("true");
      expect(
        trigger.querySelector("[data-environment-loading-placeholder]"),
      ).not.toBeNull();
      expect(trigger.textContent).not.toContain("Loading environments…");
      fireEvent.click(trigger, { button: 0 });
      const status = screen.getByRole("status", {
        name: "Loading environments",
      });
      expect(
        status.querySelectorAll("[data-environment-loading-row]"),
      ).toHaveLength(4);
      expect(screen.queryByText("Not set up for this project")).toBeNull();
      expect(screen.queryByRole("option")).toBeNull();

      rerender(
        <EnvironmentPickerUI {...props} providers={[checkoutProvider]} />,
      );
      expect(screen.queryByRole("status")).toBeNull();
      expect(
        trigger.querySelector("[data-environment-loading-placeholder]"),
      ).toBeNull();
      expect(
        screen
          .getByRole("button", { name: "Environment" })
          .getAttribute("aria-busy"),
      ).toBe("false");
      fireEvent.click(
        screen.getAllByRole("option", { name: /Project checkout/u })[0]!,
      );
      expect(props.onSelectProvider).toHaveBeenCalledWith(
        checkoutProvider,
        host.id,
      );
    },
  );

  it("bounds arbitrary provider labels without changing selection", () => {
    const verboseProvider = {
      ...checkoutProvider,
      displayName: "Project checkout with a deliberately long provider label",
    };
    const onSelectProvider = vi.fn();
    renderPicker(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={sources}
        host={host}
        isLocal
        providers={[verboseProvider, branchProvider]}
        selectedProviderHostId={host.id}
        onSelectProvider={onSelectProvider}
        className="shrink-0"
        modal={false}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Environment" });
    expect(trigger.dataset.promptboxShrinkableControl).toBe("");
    expect(
      trigger.querySelector<HTMLElement>("[data-promptbox-compact-label]")
        ?.classList,
    ).toContain("truncate");

    fireEvent.click(trigger, { button: 0 });
    fireEvent.click(
      screen.getByRole("option", { name: /New branch workspace/u }),
    );
    expect(onSelectProvider).toHaveBeenCalledWith(branchProvider, host.id);
  });

  it("omits providers absent from scoped eligibility and retains eligible rows", () => {
    const setupProvider = {
      ...optionalInputsProvider,
      availability: {
        status: "setup-required" as const,
        message: "Configure credentials",
      },
    };
    render(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={sources}
        host={host}
        isLocal
        providers={[checkoutProvider, branchProvider, setupProvider]}
        onSelectProvider={vi.fn()}
        providersByHostId={
          new Map([[host.id, [checkoutProvider, setupProvider]]])
        }
        modal={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });
    expect(
      screen.queryByRole("option", { name: /New branch workspace/u }),
    ).toBeNull();
    expect(
      screen.getByRole("option", { name: /Optional sandbox/u }),
    ).toBeTruthy();
    expect(screen.getByText("Configure credentials")).toBeTruthy();
  });
  it("omits a projectless-only provider from a project picker", () => {
    renderPicker(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={sources}
        host={host}
        isLocal
        providers={[
          checkoutProvider,
          {
            ...optionalInputsProvider,
            id: "personal-workspace",
            displayName: "Personal workspace",
            description: "Prepare a workspace for this thread.",
            icon: "Folder",
            requires: {
              projectCheckout: false,
              gitCheckout: false,
              gitRemote: false,
              projectless: true,
            },
          },
        ]}
        selectedProviderHostId={host.id}
        onSelectProvider={vi.fn()}
        modal={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });
    expect(
      screen.getByRole("option", { name: /Project checkout/u }),
    ).toBeTruthy();
    expect(screen.queryByText("Personal workspace")).toBeNull();
  });

  it("keeps a selected unavailable provider visible but disabled with its reason", () => {
    render(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={sources}
        host={host}
        isLocal
        providers={[
          {
            ...checkoutProvider,
            availability: {
              status: "unavailable",
              message: "Project source unavailable",
            },
          },
        ]}
        selectedProviderHostId={host.id}
        onSelectProvider={vi.fn()}
        modal={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    const providerItem = screen.getByRole("option", {
      name: /Project checkout/u,
    });
    expect(providerItem.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Project source unavailable")).toBeTruthy();
  });

  it("hides an unavailable provider that is not selected and keeps unknown ones", () => {
    render(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={sources}
        host={host}
        isLocal
        providers={[
          checkoutProvider,
          {
            ...branchProvider,
            availability: {
              status: "unavailable",
              message: "No reflink support",
            },
          },
          { ...optionalInputsProvider, availability: null },
        ]}
        selectedProviderHostId={host.id}
        onSelectProvider={vi.fn()}
        modal={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    expect(
      screen.getByRole("option", { name: /Project checkout/u }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: /New branch workspace/u }),
    ).toBeNull();
    expect(screen.queryByText("No reflink support")).toBeNull();
    expect(
      screen.getByRole("option", { name: /Optional sandbox/u }),
    ).toBeTruthy();
  });

  it("shows a setup-required provider enabled with its message", () => {
    render(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={sources}
        host={host}
        isLocal
        providers={[
          checkoutProvider,
          {
            ...branchProvider,
            availability: {
              status: "setup-required",
              message: "Configure credentials",
            },
          },
        ]}
        selectedProviderHostId={host.id}
        onSelectProvider={vi.fn()}
        modal={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    const branchItem = screen.getByRole("option", {
      name: /New branch workspace/u,
    });
    expect(branchItem.getAttribute("aria-disabled")).toBe("false");
    expect(screen.getByText("Configure credentials")).toBeTruthy();
  });

  it("selects a setup-required composed provider without navigating away", () => {
    const onSelectProvider = vi.fn();
    const setupRequiredProvider: SystemEnvironmentProvider = {
      ...sandboxProvider,
      machineProviderId: "modal-sandbox",
      acceptsEmptyInputs: true,
      machineAvailability: {},
      inputs: null,
      availability: {
        status: "setup-required",
        message: "Add Modal credentials",
      },
    };
    renderPicker(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={sources}
        host={host}
        isLocal
        providers={[setupRequiredProvider]}
        onSelectProvider={onSelectProvider}
        modal={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    const providerItem = screen.getByRole("option", {
      name: /Docker container/u,
    });
    expect(providerItem.getAttribute("href")).toBeNull();
    expect(screen.queryByText("Set it up in plugin settings")).toBeNull();
    expect(providerItem.getAttribute("aria-disabled")).toBe("false");
    expect(screen.getByText("Add Modal credentials")).toBeTruthy();
    fireEvent.click(providerItem);
    expect(onSelectProvider).toHaveBeenCalledWith(setupRequiredProvider, null);
  });

  it("disables a provider that declares inputs until its plugin registers a control", () => {
    const onSelectProvider = vi.fn();
    const { rerender } = render(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={sources}
        host={host}
        isLocal
        providers={[sandboxProvider]}
        onSelectProvider={onSelectProvider}
        modal={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });
    const disabledItem = screen.getByRole("option", {
      name: /Docker container/u,
    });
    expect(disabledItem.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen.getByText(PROVIDER_INPUTS_CONTROL_MISSING_REASON),
    ).toBeTruthy();

    rerender(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={sources}
        host={host}
        isLocal
        providers={[sandboxProvider]}
        inputsControlProviderIds={new Set([sandboxProvider.id])}
        onSelectProvider={onSelectProvider}
        modal={false}
      />,
    );
    const enabledItem = screen.getByRole("option", {
      name: /Docker container/u,
    });
    expect(enabledItem.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(enabledItem);
    expect(onSelectProvider).toHaveBeenCalledWith(sandboxProvider, host.id);
  });

  it("keeps a provider whose inputs schema requires nothing selectable without a control", () => {
    const onSelectProvider = vi.fn();
    renderPicker(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={sources}
        host={host}
        isLocal
        providers={[optionalInputsProvider]}
        onSelectProvider={onSelectProvider}
        modal={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });
    const item = screen.getByRole("option", { name: /Optional sandbox/u });
    expect(item.getAttribute("aria-disabled")).toBe("false");
    expect(screen.queryByText(PROVIDER_INPUTS_CONTROL_MISSING_REASON)).toBe(
      null,
    );
    fireEvent.click(item);
    expect(onSelectProvider).toHaveBeenCalledWith(
      optionalInputsProvider,
      host.id,
    );
  });
});

describe("EnvironmentPickerUI multi-machine menu", () => {
  const HOUR_MS = 60 * 60 * 1000;

  const thisMachine: Host = {
    ...host,
    id: "host_local",
    name: "MacBook Pro",
  };
  const studio: Host = {
    ...host,
    id: "host_studio",
    name: "Mac Studio",
  };
  const devVm: Host = {
    ...host,
    id: "host_vm",
    name: "dev-vm",
    status: "disconnected",
    lastSeenAt: Date.now() - 2 * HOUR_MS,
  };
  const manyHosts = [
    thisMachine,
    studio,
    devVm,
    makeHost({ ...host, id: "host_build", name: "Build server" }),
    makeHost({ ...host, id: "host_office", name: "Office Mac Studio" }),
    makeHost({ ...host, id: "host_travel", name: "Travel laptop" }),
  ] as const;

  const machineSources: readonly ProjectSource[] = [
    { ...sources[0]!, id: "src_local", hostId: thisMachine.id, path: "~/bb" },
    { ...sources[0]!, id: "src_studio", hostId: studio.id, path: "~/code/bb" },
  ];

  function renderMachineMenu(overrides?: {
    hosts?: readonly Host[];
    value?: string;
    selectedProviderHostId?: string | null;
    multiMachinePickerEnabled?: boolean;
    providers?: readonly SystemEnvironmentProvider[];
    onSelectProvider?: (
      provider: SystemEnvironmentProvider,
      hostId: string | null,
    ) => void;
  }) {
    renderPicker(
      <EnvironmentPickerUI
        value={overrides?.value ?? "provider:project-checkout"}
        sources={machineSources}
        host={thisMachine}
        isLocal
        machines={{
          hosts: overrides?.hosts ?? [thisMachine, studio, devVm],
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        providers={overrides?.providers ?? [checkoutProvider]}
        selectedProviderHostId={
          overrides?.selectedProviderHostId === undefined
            ? thisMachine.id
            : overrides.selectedProviderHostId
        }
        multiMachinePickerEnabled={overrides?.multiMachinePickerEnabled ?? true}
        onSelectProvider={overrides?.onSelectProvider ?? vi.fn()}
        modal={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });
  }

  it("shows search starting at three machines", () => {
    const result = render(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={machineSources}
        host={thisMachine}
        isLocal
        machines={{
          hosts: manyHosts.slice(0, 2),
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        providers={[checkoutProvider]}
        selectedProviderHostId={thisMachine.id}
        multiMachinePickerEnabled
        onSelectProvider={vi.fn()}
        modal={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Environment" }));
    expect(
      screen.queryByRole("combobox", { name: "Search machines" }),
    ).toBeNull();

    result.rerender(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={machineSources}
        host={thisMachine}
        isLocal
        machines={{
          hosts: manyHosts.slice(0, 3),
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        providers={[checkoutProvider]}
        selectedProviderHostId={thisMachine.id}
        multiMachinePickerEnabled
        onSelectProvider={vi.fn()}
        modal={false}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Search machines" }),
    ).toBeTruthy();
  });

  it("uses the grouped environment menu when the experiment is off", () => {
    renderMachineMenu({
      hosts: manyHosts.slice(0, 3),
      multiMachinePickerEnabled: false,
    });

    expect(
      screen.queryByRole("combobox", { name: "Search machines" }),
    ).toBeNull();
    expect(screen.queryByText("Machines")).toBeNull();
    expect(screen.getByText("this machine")).toBeTruthy();
    expect(
      screen
        .getByText("MacBook Pro")
        .parentElement?.querySelector('[data-icon="Laptop"]'),
    ).toBeNull();
    expect(
      screen.getAllByRole("option", { name: /Project checkout/u }),
    ).toHaveLength(3);
  });

  it("fuzzy-searches machine names and host ids while keeping hostless targets visible", () => {
    const modalComposition: SystemEnvironmentProvider = {
      ...sandboxProvider,
      id: "modal-composition",
      displayName: "Modal Sandbox",
      machineProviderId: "modal-sandbox",
    };
    renderMachineMenu({
      hosts: manyHosts,
      providers: [checkoutProvider, modalComposition],
    });
    const search = screen.getByRole("combobox", { name: "Search machines" });

    fireEvent.change(search, { target: { value: "OMS" } });
    expect(screen.queryByRole("option", { name: "Mac Studio" })).toBeNull();
    expect(
      screen.getByRole("option", { name: "Office Mac Studio" }),
    ).toBeTruthy();
    expect(screen.getByText("On MacBook Pro")).toBeTruthy();
    expect(
      screen.getByRole("option", { name: /Project checkout/u }),
    ).toBeTruthy();
    expect(screen.queryByText("Other environments")).toBeNull();
    expect(screen.getByRole("option", { name: /Modal Sandbox/u })).toBeTruthy();

    fireEvent.change(search, { target: { value: "host_travel" } });
    expect(screen.getByRole("option", { name: "Travel laptop" })).toBeTruthy();

    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByText("No machines found")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Modal Sandbox/u })).toBeTruthy();
  });

  it("shows one active machine's environments and caps the machine section", () => {
    const onSelectProvider = vi.fn();
    renderMachineMenu({ onSelectProvider });

    expect(screen.getByText("Machines")).toBeTruthy();
    expect(screen.getByText("MacBook Pro")).toBeTruthy();
    expect(screen.getByText("this machine")).toBeTruthy();
    expect(screen.getByText("Mac Studio")).toBeTruthy();
    expect(screen.getByText("On MacBook Pro")).toBeTruthy();
    const machineList = document.querySelector<HTMLElement>(
      "[data-machine-picker-list]",
    );
    expect(machineList?.className).toContain("max-h-48");
    expect(machineList?.className).toContain("overflow-y-auto");
    const activeMachine = screen.getByRole("option", {
      name: "MacBook Pro",
    });
    expect(activeMachine.getAttribute("aria-current")).toBe("true");
    expect(
      activeMachine.querySelector('[data-icon="Check"]')?.classList,
    ).toContain("opacity-100");

    const checkoutItems = screen.getAllByRole("option", {
      name: /Project checkout/u,
    });
    expect(checkoutItems).toHaveLength(1);

    fireEvent.click(screen.getByRole("option", { name: "Mac Studio" }));
    expect(onSelectProvider).not.toHaveBeenCalled();
    const previewedMachine = screen.getByRole("option", {
      name: "Mac Studio",
    });
    expect(previewedMachine.getAttribute("aria-current")).toBe("true");
    expect(
      previewedMachine.querySelector('[data-icon="Check"]')?.classList,
    ).toContain("opacity-100");
    expect(activeMachine.getAttribute("aria-current")).toBeNull();
    expect(
      activeMachine.querySelector('[data-icon="Check"]')?.classList,
    ).toContain("opacity-0");
    expect(screen.getByText("On Mac Studio")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Project checkout/u }));
    expect(onSelectProvider).toHaveBeenCalledWith(checkoutProvider, studio.id);
  });

  it("shows a selected hostless target without a machine environment section", () => {
    const modalComposition: SystemEnvironmentProvider = {
      ...sandboxProvider,
      id: "modal-composition",
      displayName: "Modal Sandbox",
      machineProviderId: "modal-sandbox",
    };
    renderMachineMenu({
      value: "provider:modal-composition",
      selectedProviderHostId: null,
      providers: [checkoutProvider, modalComposition],
    });

    const modalTarget = screen.getByRole("option", { name: /Modal Sandbox/u });
    expect(
      modalTarget.querySelector("[data-machine-status-spacer]"),
    ).not.toBeNull();
    expect(modalTarget.getAttribute("aria-current")).toBe("true");
    expect(
      modalTarget.querySelector('[data-icon="Check"]')?.classList,
    ).toContain("opacity-100");
    expect(screen.queryByText(/On MacBook Pro/u)).toBeNull();
    expect(
      screen.queryByRole("option", { name: /Project checkout/u }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("option", { name: "Mac Studio" }));
    expect(modalTarget.getAttribute("aria-current")).toBeNull();
    expect(
      modalTarget.querySelector('[data-icon="Check"]')?.classList,
    ).toContain("opacity-0");
    expect(screen.getByText("On Mac Studio")).toBeTruthy();
  });

  it("does not show project checkout paths in machine headers", () => {
    renderMachineMenu();

    expect(screen.queryByText("~/bb")).toBeNull();
    expect(screen.queryByText("~/code/bb")).toBeNull();
  });

  it("selects a host-scoped provider for the previewed machine", () => {
    const onSelectProvider = vi.fn();
    renderMachineMenu({
      providers: [branchProvider],
      onSelectProvider,
    });

    fireEvent.click(screen.getByRole("option", { name: "Mac Studio" }));
    const providerItem = screen.getByRole("option", {
      name: /New branch workspace/u,
    });
    fireEvent.click(providerItem);
    expect(onSelectProvider).toHaveBeenCalledWith(branchProvider, studio.id);
  });

  it("hides existing ephemeral hosts and keeps their composition entry", () => {
    const ephemeralHost: Host = {
      ...studio,
      id: "host_sandbox",
      name: "Modal sandbox 3f9a",
      type: "ephemeral",
      machineProviderId: "modal-sandbox",
    };
    const modalComposition: SystemEnvironmentProvider = {
      ...sandboxProvider,
      id: "modal-composition",
      displayName: "Modal Sandbox",
      machineProviderId: "modal-sandbox",
    };
    renderPicker(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={machineSources}
        host={thisMachine}
        isLocal
        machines={{
          hosts: [thisMachine, studio, ephemeralHost],
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        providers={[checkoutProvider, modalComposition]}
        selectedProviderHostId={thisMachine.id}
        onSelectProvider={vi.fn()}
        modal={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    expect(screen.queryByText(ephemeralHost.name)).toBeNull();
    expect(screen.getByRole("option", { name: /Modal Sandbox/u })).toBeTruthy();
    expect(
      screen.getAllByRole("option", { name: /Project checkout/u }),
    ).toHaveLength(2);
  });

  it("hides a provider on the machine that reports it unavailable", () => {
    render(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={machineSources}
        host={thisMachine}
        isLocal
        machines={{
          hosts: [thisMachine, studio],
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        providers={[checkoutProvider]}
        providersByHostId={
          new Map([
            [
              thisMachine.id,
              [
                {
                  ...checkoutProvider,
                  availability: { status: "available" },
                },
              ],
            ],
            [
              studio.id,
              [
                {
                  ...checkoutProvider,
                  availability: {
                    status: "unavailable",
                    message: "Checkout missing on Mac Studio",
                  },
                },
              ],
            ],
          ])
        }
        selectedProviderHostId={thisMachine.id}
        onSelectProvider={vi.fn()}
        modal={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    const checkoutItems = screen.getAllByRole("option", {
      name: /Project checkout/u,
    });
    expect(checkoutItems).toHaveLength(1);
    expect(checkoutItems[0]!.getAttribute("aria-disabled")).toBe("false");
    expect(screen.queryByText("Checkout missing on Mac Studio")).toBeNull();
  });

  it("disables an offline machine's options and shows when it was last seen", () => {
    renderMachineMenu();

    fireEvent.click(screen.getByRole("option", { name: "dev-vm" }));
    expect(screen.getByText(/last seen 2h ago/u)).toBeTruthy();
    const checkoutItems = screen.getAllByRole("option", {
      name: /Project checkout/u,
    });
    expect(checkoutItems).toHaveLength(1);
    expect(checkoutItems[0]!.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows protocol versions instead of plain offline metadata for stale daemons", () => {
    const staleVm: Host = {
      ...devVm,
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
    };
    renderPicker(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={machineSources}
        host={thisMachine}
        isLocal
        machines={{
          hosts: [thisMachine, staleVm],
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        modal={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    expect(
      screen.getByText(
        `Needs update · daemon protocol ${HOST_DAEMON_PROTOCOL_VERSION - 1} · server protocol ${HOST_DAEMON_PROTOCOL_VERSION}`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/last seen 2h ago/u)).toBeNull();
  });

  it("disables options on an offline machine that has a source", () => {
    const offlineStudio: Host = { ...studio, status: "disconnected" };
    renderPicker(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={machineSources}
        host={thisMachine}
        isLocal
        machines={{
          hosts: [thisMachine, offlineStudio],
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        providers={[checkoutProvider]}
        selectedProviderHostId={thisMachine.id}
        onSelectProvider={vi.fn()}
        modal={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    const checkoutItems = screen.getAllByRole("option", {
      name: /Project checkout/u,
    });
    expect(checkoutItems).toHaveLength(2);
    expect(checkoutItems[0]!.getAttribute("aria-disabled")).toBe("false");
    expect(checkoutItems[1]!.getAttribute("aria-disabled")).toBe("true");
  });

  it.each(["removing", "resuming"] as const)(
    "disables options on a machine that is %s",
    (phase) => {
      const unavailableStudio: Host = {
        ...studio,
        lifecycle: { ...studio.lifecycle, phase },
      };
      renderPicker(
        <EnvironmentPickerUI
          value="provider:project-checkout"
          sources={machineSources}
          host={thisMachine}
          isLocal
          machines={{
            hosts: [thisMachine, unavailableStudio],
            localDaemonHostId: thisMachine.id,
            primaryHostId: thisMachine.id,
          }}
          providers={[checkoutProvider]}
          selectedProviderHostId={thisMachine.id}
          onSelectProvider={vi.fn()}
          modal={false}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
        button: 0,
      });

      const checkoutItems = screen.getAllByRole("option", {
        name: /Project checkout/u,
      });
      expect(checkoutItems[1]!.getAttribute("aria-disabled")).toBe("true");
    },
  );

  it("offers guided setup for a connected machine without a source", () => {
    const onRequestMachineSetup = vi.fn();
    const onlineVm: Host = { ...devVm, status: "connected", lastSeenAt: null };
    renderPicker(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={machineSources}
        host={thisMachine}
        isLocal
        machines={{
          hosts: [thisMachine, studio, onlineVm],
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        onRequestMachineSetup={onRequestMachineSetup}
        multiMachinePickerEnabled
        modal={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    expect(screen.queryByText("Not set up for this project")).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "dev-vm" }));
    fireEvent.click(screen.getByRole("option", { name: /Set up on dev-vm…/u }));
    expect(onRequestMachineSetup).toHaveBeenCalledWith(onlineVm);
  });

  it("offers guided setup below host-scoped providers on a connected machine without a source", () => {
    const onRequestMachineSetup = vi.fn();
    const onSelectProvider = vi.fn();
    const onlineVm: Host = { ...devVm, status: "connected", lastSeenAt: null };
    const hostProvider = {
      ...checkoutProvider,
      id: "host-sandbox",
      displayName: "Host sandbox",
      description: "Prepare a workspace for this thread.",
      icon: "Folder",
      requires: {
        ...checkoutProvider.requires,
        projectCheckout: false,
      },
    };
    renderPicker(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={machineSources}
        host={thisMachine}
        isLocal
        machines={{
          hosts: [thisMachine, onlineVm],
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        providers={[hostProvider]}
        selectedProviderHostId={thisMachine.id}
        onSelectProvider={onSelectProvider}
        onRequestMachineSetup={onRequestMachineSetup}
        modal={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    expect(
      screen.getAllByRole("option", { name: /Host sandbox/u }),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("option", { name: /Set up on dev-vm…/u }));
    expect(onRequestMachineSetup).toHaveBeenCalledWith(onlineVm);
  });

  it("keeps the disabled not-set-up row for an offline machine", () => {
    renderPicker(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={machineSources}
        host={thisMachine}
        isLocal
        machines={{
          hosts: [thisMachine, studio, devVm],
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        onRequestMachineSetup={vi.fn()}
        multiMachinePickerEnabled
        modal={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    fireEvent.click(screen.getByRole("option", { name: "dev-vm" }));
    expect(screen.queryByText(/Set up on dev-vm/u)).toBeNull();
    const placeholder = screen.getByRole("option", {
      name: "Not set up for this project",
    });
    expect(placeholder.getAttribute("aria-disabled")).toBe("true");
  });

  it("names the primary machine in the trigger label when multiple machines exist", () => {
    renderMachineMenu();

    expect(screen.getByText("MacBook Pro · Project checkout")).toBeTruthy();
    expect(
      document.querySelector("[data-promptbox-compact-label]")?.textContent,
    ).toBe("Project checkout");
  });

  it("names another selected machine in the trigger label", () => {
    renderMachineMenu({ selectedProviderHostId: studio.id });

    expect(screen.getByText("Mac Studio · Project checkout")).toBeTruthy();
  });

  it("lists every eligible provider row under each machine", () => {
    const onSelectProvider = vi.fn();
    renderPicker(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={machineSources}
        host={thisMachine}
        isLocal
        machines={{
          hosts: [thisMachine, studio],
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        providers={[branchProvider, sandboxProvider]}
        selectedProviderHostId={null}
        inputsControlProviderIds={new Set([sandboxProvider.id])}
        onSelectProvider={onSelectProvider}
        modal={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    const providerItems = screen.getAllByRole("option", {
      name: /New branch workspace/u,
    });
    expect(providerItems).toHaveLength(2);
    fireEvent.click(providerItems[1]!);
    expect(onSelectProvider).toHaveBeenCalledWith(branchProvider, studio.id);

    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });
    const sandboxItems = screen.getAllByRole("option", {
      name: /Docker container/u,
    });
    expect(sandboxItems).toHaveLength(2);
    fireEvent.click(sandboxItems[0]!);
    expect(onSelectProvider).toHaveBeenCalledWith(
      sandboxProvider,
      thisMachine.id,
    );
  });

  it("names the selected machine and provider display name in the trigger label", () => {
    renderPicker(
      <EnvironmentPickerUI
        value="provider:branchy"
        sources={machineSources}
        host={studio}
        isLocal={false}
        machines={{
          hosts: [thisMachine, studio],
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        providers={[branchProvider]}
        selectedProviderHostId={studio.id}
        onSelectProvider={vi.fn()}
        modal={false}
      />,
    );

    expect(screen.getByText("Mac Studio · New branch workspace")).toBeTruthy();
  });

  it("reports an offline machine ahead of the provider it was selected on", () => {
    const offlineStudio: Host = { ...studio, status: "disconnected" };
    renderPicker(
      <EnvironmentPickerUI
        value="provider:branchy"
        sources={machineSources}
        host={offlineStudio}
        isLocal={false}
        machines={{
          hosts: [thisMachine, offlineStudio],
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        providers={[branchProvider]}
        selectedProviderHostId={offlineStudio.id}
        onSelectProvider={vi.fn()}
        modal={false}
      />,
    );

    expect(screen.getByText("Mac Studio · Host is offline")).toBeTruthy();
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.queryByText(/New branch workspace/u)).toBeNull();
  });

  it("keeps the single-host menu when only one host exists", () => {
    renderPicker(
      <EnvironmentPickerUI
        value="provider:project-checkout"
        sources={machineSources}
        host={thisMachine}
        isLocal
        machines={{
          hosts: [thisMachine],
          localDaemonHostId: thisMachine.id,
          primaryHostId: thisMachine.id,
        }}
        providers={[checkoutProvider]}
        selectedProviderHostId={thisMachine.id}
        onSelectProvider={vi.fn()}
        modal={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    expect(
      screen.getByRole("option", { name: /Project checkout/u }),
    ).toBeTruthy();
    expect(screen.queryByText("MacBook Pro")).toBeNull();
  });
});

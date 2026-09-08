// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginMachineProviderInputsProps } from "@get-bb/plugin-sdk/app";
import { sshMachineRpcContract } from "./contract.js";
import { SSH_MACHINE_PROVIDER_ID } from "./provider-id.js";

const app = await loadPluginApp(() => import("./app"));

afterEach(() => {
  cleanup();
});

function inputsSlot() {
  const registration = app.machineProviderInputs.find(
    (candidate) => candidate.machineProviderId === SSH_MACHINE_PROVIDER_ID,
  );
  if (registration === undefined) {
    throw new Error("SSH machine inputs control was not registered");
  }
  return registration;
}

function renderInputs(
  onChange: PluginMachineProviderInputsProps["onChange"],
  value = null,
) {
  return renderSlot<
    PluginMachineProviderInputsProps,
    typeof sshMachineRpcContract
  >(
    inputsSlot(),
    { projectId: null, value, onChange },
    { rpc: { listTargets: async () => ["buildbox", "gpu"] } },
  );
}

describe("SSH machine inputs control", () => {
  it("registers for the SSH machine provider", () => {
    expect(
      app.machineProviderInputs.map((row) => row.machineProviderId),
    ).toEqual(["ssh-machine"]);
  });

  it("loads aliases from the server machine and selects the first", async () => {
    const onChange = vi.fn<PluginMachineProviderInputsProps["onChange"]>();
    const slot = renderInputs(onChange);
    await waitFor(() => {
      expect(slot.getByLabelText("SSH host")).toHaveProperty(
        "value",
        "buildbox",
      );
      expect(onChange).toHaveBeenLastCalledWith({
        status: "ready",
        value: { target: "buildbox" },
      });
    });
  });

  it("does not reload aliases when the host replaces its callback", async () => {
    const firstOnChange = vi.fn<PluginMachineProviderInputsProps["onChange"]>();
    const slot = renderInputs(firstOnChange);
    await waitFor(() => expect(firstOnChange).toHaveBeenCalled());
    const secondOnChange =
      vi.fn<PluginMachineProviderInputsProps["onChange"]>();
    const Component = inputsSlot().component;
    slot.rerender(
      <Component projectId={null} value={null} onChange={secondOnChange} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondOnChange).not.toHaveBeenCalled();
  });

  it("accepts a typed user@host destination", async () => {
    const onChange = vi.fn<PluginMachineProviderInputsProps["onChange"]>();
    const slot = renderInputs(onChange);
    await waitFor(() => expect(slot.getByLabelText("SSH host")).toBeTruthy());
    fireEvent.change(slot.getByLabelText("SSH host"), {
      target: { value: "dev@new-host.example.com" },
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith({
        status: "ready",
        value: { target: "dev@new-host.example.com" },
      });
    });
  });

  it("blocks a typed destination with shell metacharacters", async () => {
    const onChange = vi.fn<PluginMachineProviderInputsProps["onChange"]>();
    const slot = renderInputs(onChange);
    await waitFor(() => expect(slot.getByLabelText("SSH host")).toBeTruthy());
    fireEvent.change(slot.getByLabelText("SSH host"), {
      target: { value: "host; reboot" },
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith({
        status: "blocked",
        reason:
          "Enter an SSH host alias or user@host without spaces or shell metacharacters.",
      });
    });
  });
});

it("accepts typed hosts even when alias discovery fails", async () => {
  const onChange = vi.fn<PluginMachineProviderInputsProps["onChange"]>();
  const slot = renderSlot<
    PluginMachineProviderInputsProps,
    typeof sshMachineRpcContract
  >(
    inputsSlot(),
    { projectId: null, value: null, onChange },
    {
      rpc: {
        listTargets: async () => {
          throw new Error("Config unavailable");
        },
      },
    },
  );
  await waitFor(() => expect(slot.getByLabelText("SSH host")).toBeTruthy());
  fireEvent.change(slot.getByLabelText("SSH host"), {
    target: { value: "dev@box" },
  });
  await waitFor(() =>
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { target: "dev@box" },
    }),
  );
});

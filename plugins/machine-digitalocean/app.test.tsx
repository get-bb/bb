// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  JsonValue,
  PluginMachineProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import { inputsSchema } from "./inputs.js";

const app = await loadPluginApp(() => import("./app.js"));
afterEach(cleanup);

function renderInputs(value: JsonValue | null = null) {
  const registration = app.machineProviderInputs.find(
    (slot) => slot.machineProviderId === "digitalocean",
  );
  if (registration === undefined)
    throw new Error("DigitalOcean inputs slot missing");
  const onChange = vi.fn<PluginMachineProviderInputsProps["onChange"]>();
  const slot = renderSlot<PluginMachineProviderInputsProps>(registration, {
    projectId: null,
    value,
    onChange,
  });
  return { slot, onChange };
}

describe("DigitalOcean machine inputs", () => {
  it("makes the server defaults ready in the Machines-page picker", async () => {
    const { slot, onChange } = renderInputs();
    expect(slot.getByLabelText("Region")).toHaveProperty("value", "nyc3");
    expect(slot.getByLabelText("Size")).toHaveProperty("value", "s-2vcpu-4gb");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        status: "ready",
        value: inputsSchema.parse({}),
      }),
    );
  });
  it("restores a saved machine selection", async () => {
    const value = { region: "ams3", size: "s-4vcpu-8gb", idleMinutes: null };
    const { slot, onChange } = renderInputs(value);
    expect(slot.getByLabelText("Region")).toHaveProperty("value", value.region);
    expect(slot.getByLabelText("Size")).toHaveProperty("value", value.size);
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ status: "ready", value }),
    );
  });
  it("passes edited region and size together without losing the other field", async () => {
    const { slot, onChange } = renderInputs();
    fireEvent.change(slot.getByLabelText("Region"), {
      target: { value: "sfo3" },
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        status: "ready",
        value: { region: "sfo3", size: "s-2vcpu-4gb", idleMinutes: null },
      }),
    );
    fireEvent.change(slot.getByLabelText("Size"), {
      target: { value: "s-4vcpu-8gb" },
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        status: "ready",
        value: { region: "sfo3", size: "s-4vcpu-8gb", idleMinutes: null },
      }),
    );
  });
  it.each([
    { field: "Region", invalid: "", valid: "nyc3" },
    { field: "Size", invalid: "4 vCPU", valid: "s-2vcpu-4gb" },
  ])(
    "blocks invalid $field and becomes ready after correction",
    async ({ field, invalid, valid }) => {
      const { slot, onChange } = renderInputs();
      fireEvent.change(slot.getByLabelText(field), {
        target: { value: invalid },
      });
      await waitFor(() =>
        expect(onChange).toHaveBeenLastCalledWith({
          status: "blocked",
          reason: `${field} must use lowercase letters, numbers, and hyphens.`,
        }),
      );
      expect(slot.getByRole("alert").textContent).toContain(field);
      fireEvent.change(slot.getByLabelText(field), {
        target: { value: valid },
      });
      await waitFor(() =>
        expect(onChange).toHaveBeenLastCalledWith({
          status: "ready",
          value: inputsSchema.parse({}),
        }),
      );
      expect(slot.queryByRole("alert")).toBeNull();
    },
  );
  it("keeps an invalid saved value visible and blocks creation", async () => {
    const { slot, onChange } = renderInputs({
      region: "NYC 3",
      size: "s-2vcpu-4gb",
    });
    expect(slot.getByLabelText("Region")).toHaveProperty("value", "NYC 3");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        status: "blocked",
        reason: "Region must use lowercase letters, numbers, and hyphens.",
      }),
    );
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginMachineProviderInputsProps } from "@get-bb/plugin-sdk/app";
import { tailscaleContract } from "./contract.js";
const app = await loadPluginApp(() => import("./app"));
afterEach(cleanup);
it("requires explicit device/user and verifies private access without falling back", async () => {
  const registration = app.machineProviderInputs[0];
  const onChange = vi.fn<PluginMachineProviderInputsProps["onChange"]>();
  const status = {
    available: false,
    serverUrl: null,
    port: null,
    message: "Configure Serve",
    loopbackUrl: "http://127.0.0.1:23354",
  };
  const configure = vi.fn(async () => ({
    ...status,
    available: true,
    serverUrl: "https://server.example.ts.net:8443",
    port: 8443,
  }));
  const view = renderSlot<
    PluginMachineProviderInputsProps,
    typeof tailscaleContract
  >(
    registration,
    { projectId: null, value: null, onChange },
    {
      rpc: {
        devices: async () => [
          {
            id: "peer",
            label: "Mac",
            dnsName: "mac.example.ts.net",
            os: "macOS",
            online: true,
          },
          {
            id: "offline",
            label: "Sleeping",
            dnsName: "sleep.example.ts.net",
            os: "macOS",
            online: false,
          },
        ],
        accessStatus: async () => status,
        configure,
      },
    },
  );
  await waitFor(() => expect(view.getByText("Configure Serve")).toBeDefined());
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "blocked" }),
  );
  fireEvent.change(view.getByLabelText("Tailnet device"), {
    target: { value: "peer" },
  });
  fireEvent.change(view.getByLabelText("OS username"), {
    target: { value: "dev" },
  });
  expect(onChange).toHaveBeenLastCalledWith({
    status: "blocked",
    reason: "Verify private server access first.",
  });
  fireEvent.click(view.getByText("Verify Serve endpoint"));
  await waitFor(() =>
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: {
        deviceId: "peer",
        username: "dev",
        nodeDirectory: null,
        accessProviderId: "tailscale",
      },
    }),
  );
  expect(configure).toHaveBeenCalledWith({ port: 8443 });
  fireEvent.change(view.getByLabelText("OS username"), {
    target: { value: "dev;bad" },
  });
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "blocked" }),
  );
});

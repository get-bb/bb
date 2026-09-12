import type { JsonValue } from "@get-bb/plugin-sdk";
import type { PluginMachineProviderProgress } from "@get-bb/plugin-sdk/machine-provider";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import type { SandboxBackend } from "./sandbox-backend.js";
import { registerSandboxBackend } from "./register.js";

const inputsSchema = z.object({ size: z.enum(["small", "large"]) }).strict();
const resourceSchema = z
  .object({ key: z.string(), instanceId: z.string() })
  .strict();
type Inputs = z.infer<typeof inputsSchema>;
type Resource = z.infer<typeof resourceSchema>;

const report: PluginMachineProviderProgress = {
  step() {},
  log() {},
};

it("registers a non-Modal backend through the shared extension point", async () => {
  const executor = { exec: vi.fn(async () => ({ exitCode: 0 })) };
  const backend: SandboxBackend<Inputs, Resource> = {
    definition: {
      id: "example-sandbox",
      displayName: "Example Sandbox",
      description: "Create an example sandbox.",
      environmentDescription: "Create a checkout in an example sandbox.",
      runtimeName: "Example",
      icon: "Box",
      ephemeral: true,
      inputs: inputsSchema,
    },
    parseInputs: (value) => inputsSchema.parse(value),
    parseResource: (value) => resourceSchema.parse(value),
    allocationKey: (resource) => resource.key,
    availability: async () => ({ status: "available" }),
    validate: async () => ({ action: "accept" }),
    async create(context) {
      const resource = { key: context.key, instanceId: "example-1" };
      await context.checkpoint(resource);
      return { resource, executor };
    },
    async reconcileCleanup() {},
    async suspend(context) {
      return context.resource;
    },
    async resume(context) {
      return { resource: context.resource, executor };
    },
    async remove() {},
    displayName: ({ hostId }) => `Example ${hostId}`,
    close() {},
  };
  const { bb, harness } = createFakePluginHost({ pluginId: "test-plugin" });
  const bootstrap = vi.fn(async () => ({ hostId: "host_example" }));
  Object.assign(bb.experimental_machines, { bootstrap });
  const onConnected = vi.fn(async () => {});

  registerSandboxBackend(bb, backend, {
    now: () => 1,
    onConnected,
  });

  const machine = harness.registrations.machineProviders.get("example-sandbox");
  expect(machine).toBeDefined();
  expect(
    harness.registrations.environmentCompositions.get("example-sandbox"),
  ).toMatchObject({
    machineProviderId: "example-sandbox",
    environmentProviderId: "project-checkout",
  });
  const checkpoint = vi.fn(async (_resource: JsonValue) => {});
  await expect(
    machine?.create({
      key: "allocation-key",
      attempt: 1,
      inputs: { size: "large" },
      report,
      signal: new AbortController().signal,
      checkpoint,
    }),
  ).resolves.toEqual({
    status: "created",
    name: "Example host_example",
    resource: { key: "allocation-key", instanceId: "example-1" },
  });
  expect(checkpoint.mock.invocationCallOrder[0]).toBeLessThan(
    bootstrap.mock.invocationCallOrder[0]!,
  );
  expect(onConnected).toHaveBeenCalledWith("host_example");
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineRpcContract,
  type StandardSchemaV1,
} from "../../rpc-contract.js";
import { createFakePluginHost } from "../index.js";

const exported = defineRpcContract({
  "usage.v1.get": {
    experimental_description: "Reads cached usage unless refresh is true.",
    input: z.object({
      refresh: z.boolean().describe("Request fresh measurements."),
    }),
    output: z.object({ percent: z.number() }),
  },
});

describe("discoverable RPC registration", () => {
  it("publishes descriptions and wire schemas while leaving other methods private", async () => {
    const { bb, harness } = createFakePluginHost();
    try {
      bb.rpc.register(
        exported,
        { "usage.v1.get": () => ({ percent: 42 }) },
        {
          experimental_discoverable: true,
          experimental_description: "Shared accounts",
        },
      );
      bb.rpc.register(
        { private: { input: z.null(), output: z.null() } },
        { private: () => null },
        {
          experimental_description:
            "A description alone does not publish this method.",
        },
      );
      expect(harness.registrations.experimental_publishedRpcMethods).toEqual([
        {
          method: "usage.v1.get",
          registrationDescription: "Shared accounts",
          methodDescription: "Reads cached usage unless refresh is true.",
          inputSchema: expect.objectContaining({
            properties: {
              refresh: {
                type: "boolean",
                description: "Request fresh measurements.",
              },
            },
          }),
          outputSchema: expect.objectContaining({
            properties: { percent: { type: "number" } },
          }),
        },
      ]);
      await expect(
        harness.behavior.callRpc("private", null),
      ).resolves.toBeNull();
      await expect(
        harness.behavior.callRpc("usage.v1.get", { refresh: false }),
      ).resolves.toEqual({ percent: 42 });
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it("rejects unexportable methods atomically but accepts them without publication", async () => {
    const { bb, harness } = createFakePluginHost();
    const validator: StandardSchemaV1 = {
      "~standard": {
        version: 1,
        vendor: "validation-only",
        validate: (value) => ({ value }),
      },
    };
    const contract = defineRpcContract({
      first: { input: z.null(), output: z.null() },
      second: { input: validator, output: validator },
    });
    try {
      expect(() =>
        bb.rpc.register(
          contract,
          { first: () => null, second: () => null },
          { experimental_discoverable: true },
        ),
      ).toThrow('rpc method "second" cannot be published');
      expect(harness.registrations.rpcMethods).toEqual([]);
      expect(harness.registrations.experimental_publishedRpcMethods).toEqual(
        [],
      );
      bb.rpc.register(contract, { first: () => null, second: () => null });
      await expect(
        harness.behavior.callRpc("second", null),
      ).resolves.toBeNull();
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it("replaces descriptors on reload and keeps null descriptions explicit", async () => {
    let host = createFakePluginHost();
    try {
      host = await host.harness.lifecycle.reload((bb) => {
        bb.rpc.register(
          exported,
          { "usage.v1.get": () => ({ percent: 42 }) },
          { experimental_discoverable: true },
        );
      });
      expect(
        host.harness.registrations.experimental_publishedRpcMethods[0]
          ?.registrationDescription,
      ).toBeNull();
      host = await host.harness.lifecycle.reload((bb) => {
        bb.rpc.register(
          { "usage.v2.get": { input: z.null(), output: z.null() } },
          { "usage.v2.get": () => null },
          { experimental_discoverable: true },
        );
      });
      expect(
        host.harness.registrations.experimental_publishedRpcMethods.map(
          (item) => item.method,
        ),
      ).toEqual(["usage.v2.get"]);
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });
});

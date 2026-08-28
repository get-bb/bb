import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as bridgeProtocol from "../index.js";
import * as zodInspection from "./zod-shape.js";

function fieldsByDiscriminator(
  union: z.ZodType,
  discriminator: string,
): Record<string, Record<string, zodInspection.ZodFieldPresence>> {
  const entries = zodInspection.zodUnionOptions(union).map((option) => {
    const fields = zodInspection.zodObjectFields(option);
    const discriminatorSchema =
      zodInspection["zodObjectShape"](option)[discriminator];
    const value = z
      .string()
      .safeParse(
        discriminatorSchema
          ? zodInspection.zodLiteralValue(discriminatorSchema)
          : undefined,
      );
    if (!value.success) {
      throw new Error(
        `union member without a string "${discriminator}" literal: ${JSON.stringify(Object.keys(fields))}`,
      );
    }
    return [value.data, fields] as const;
  });
  entries.sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

describe("guardrail G3: delta grammar shape is paired with the protocol version", () => {
  it("matches the committed grammar snapshot", async () => {
    const grammar = {
      protocolVersion: bridgeProtocol.PROVIDER_BRIDGE_PROTOCOL_VERSION,
      deltaKinds: fieldsByDiscriminator(
        bridgeProtocol.threadDeltaSchema,
        "kind",
      ),
      ["itemShapes"]: fieldsByDiscriminator(
        bridgeProtocol["deltaItemShapeSchema"],
        "type",
      ),
      presentation: zodInspection.zodObjectFields(
        bridgeProtocol.deltaPresentationSchema,
      ),
      capabilities: zodInspection.zodObjectFields(
        bridgeProtocol.bridgeCapabilitiesSchema,
      ),
      recoveryNotification: zodInspection.zodObjectFields(
        bridgeProtocol.providerRecoveryNotificationSchema,
      ),
      requestMethods: Object.values(
        bridgeProtocol.BRIDGE_REQUEST_METHODS,
      ).sort(),
      notificationMethods: Object.values(
        bridgeProtocol.BRIDGE_NOTIFICATION_METHODS,
      ).sort(),
      inboundRequestMethods: Object.values(
        bridgeProtocol.BRIDGE_INBOUND_REQUEST_METHODS,
      ).sort(),
    };
    await expect(`${JSON.stringify(grammar, null, 2)}\n`).toMatchFileSnapshot(
      `./provider-bridge-grammar.v${bridgeProtocol.PROVIDER_BRIDGE_PROTOCOL_VERSION}.snapshot.json`,
    );
  });

  it("keeps the protocol at version 2 while v3 is additive", () => {
    expect(bridgeProtocol.PROVIDER_BRIDGE_PROTOCOL_VERSION).toBe(2);
  });
});

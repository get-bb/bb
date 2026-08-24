/**
 * Guardrail G3 — grammar version pairing.
 *
 * Pairs a structural snapshot of the `thread/delta` grammar (every delta
 * kind and its fields, every item shape and its fields, the presentation
 * vocabulary, the handshake capabilities, and the method tables) with
 * `PROVIDER_BRIDGE_PROTOCOL_VERSION`. Changing the grammar without updating
 * the committed snapshot fails this test, which puts the diff in front of a
 * reviewer together with the version question.
 *
 * The version is NOT bumped for grammar v3. version.ts states the rule: bump
 * only for changes an older bridge or runtime cannot tolerate. Every v3
 * addition is a new union member or an optional field — a v2 bridge's
 * deltas still validate and a v2 runtime ignores a notification method it
 * does not know — so the wire stays at 2 and the `grammarVersions` handshake
 * range is how a bridge says which vocabulary it speaks. Members only one
 * in-repo bridge ever spoke (`thread.goal`, the `thread/openWork`
 * notification, `turn.plan`) were dropped under that range once the bridge
 * migrated; the
 * stabilization workstream that makes `presentation` required is the one
 * that tightens the parse for every bridge and must bump.
 *
 * To accept an intentional grammar change: review the diff, then run
 *   pnpm exec turbo run test --filter=@bb/provider-bridge-protocol -- -u
 * and commit the updated snapshot in the same PR.
 */
import { describe, expect, it } from "vitest";
import {
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  bridgeCapabilitiesSchema,
  deltaItemShapeSchema,
  deltaPresentationSchema,
  providerRecoveryNotificationSchema,
  threadDeltaSchema,
} from "../index.js";
import type { z } from "zod";
import {
  zodLiteralValue,
  zodObjectFields,
  zodObjectShape,
  zodUnionOptions,
  type ZodFieldPresence,
} from "./zod-shape.js";

function fieldsByDiscriminator(
  union: z.ZodType,
  discriminator: string,
): Record<string, Record<string, ZodFieldPresence>> {
  const entries = zodUnionOptions(union).map((option) => {
    const fields = zodObjectFields(option);
    const discriminatorSchema = zodObjectShape(option)[discriminator];
    const value = discriminatorSchema
      ? zodLiteralValue(discriminatorSchema)
      : undefined;
    if (typeof value !== "string") {
      throw new Error(
        `union member without a string "${discriminator}" literal: ${JSON.stringify(Object.keys(fields))}`,
      );
    }
    return [value, fields] as const;
  });
  entries.sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

describe("guardrail G3: delta grammar shape is paired with the protocol version", () => {
  it("matches the committed grammar snapshot", async () => {
    const grammar = {
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      deltaKinds: fieldsByDiscriminator(threadDeltaSchema, "kind"),
      itemShapes: fieldsByDiscriminator(deltaItemShapeSchema, "type"),
      presentation: zodObjectFields(deltaPresentationSchema),
      capabilities: zodObjectFields(bridgeCapabilitiesSchema),
      recoveryNotification: zodObjectFields(providerRecoveryNotificationSchema),
      requestMethods: Object.values(BRIDGE_REQUEST_METHODS).sort(),
      notificationMethods: Object.values(BRIDGE_NOTIFICATION_METHODS).sort(),
      inboundRequestMethods: Object.values(
        BRIDGE_INBOUND_REQUEST_METHODS,
      ).sort(),
    };
    await expect(`${JSON.stringify(grammar, null, 2)}\n`).toMatchFileSnapshot(
      `./provider-bridge-grammar.v${PROVIDER_BRIDGE_PROTOCOL_VERSION}.snapshot.json`,
    );
  });

  it("keeps the protocol at version 2 while v3 is additive", () => {
    // See the file header: bumping here is the v2-deletion workstream's job.
    // If this fails because you bumped the version deliberately, rename the
    // snapshot file to match and update this assertion in the same change.
    expect(PROVIDER_BRIDGE_PROTOCOL_VERSION).toBe(2);
  });
});

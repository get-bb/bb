import { describe, expect, it } from "vitest";
import {
  appDataChangedBroadcastMessageSchema,
  appDataResyncBroadcastMessageSchema,
  serverMessageLenientSchema,
  serverMessageSchema,
} from "../src/api-types.js";

/**
 * Drift guard between the strict app-data broadcast schemas and their
 * hand-maintained lenient inbound twins (the changed-message halves are
 * guarded in @bb/domain): a field added to a strict schema but not its
 * lenient counterpart would be silently stripped from every inbound message.
 */
describe("lenient server-message schema parity", () => {
  it("declares the same app-data field sets as the strict schemas", () => {
    const [, lenientAppDataChanged, lenientAppDataResync] =
      serverMessageLenientSchema.options;

    expect(Object.keys(lenientAppDataChanged.shape).sort()).toEqual(
      Object.keys(appDataChangedBroadcastMessageSchema.shape).sort(),
    );
    expect(Object.keys(lenientAppDataResync.shape).sort()).toEqual(
      Object.keys(appDataResyncBroadcastMessageSchema.shape).sort(),
    );
  });

  it("lenient parse preserves maximal strict app-data broadcasts", () => {
    const maximalMessages = [
      {
        type: "app-data.changed",
        applicationId: "status",
        path: "state.json",
        value: { nested: [1, "two", null, { deep: true }] },
        deleted: false,
        version: "v1",
      },
      {
        type: "app-data.resync",
        applicationId: "status",
      },
    ];

    for (const message of maximalMessages) {
      // The fixture is valid strict output...
      expect(serverMessageSchema.parse(message)).toEqual(message);
      // ...and the lenient parse must not strip or rewrite any of it.
      expect(serverMessageLenientSchema.parse(message)).toEqual(message);
    }

    // The fixtures stay maximal: every declared strict field is populated, so
    // a new field cannot dodge the round-trip above.
    expect(Object.keys(maximalMessages[0]).sort()).toEqual(
      Object.keys(appDataChangedBroadcastMessageSchema.shape).sort(),
    );
    expect(Object.keys(maximalMessages[1]).sort()).toEqual(
      Object.keys(appDataResyncBroadcastMessageSchema.shape).sort(),
    );
  });
});

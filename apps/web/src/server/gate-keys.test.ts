import { describe, expect, it } from "vitest";
import { generateGateKeyPair } from "@bb/tunnel-contract/next";
import { GATE_KEYS_CACHE_CONTROL, gateKeysResponse } from "./gate-keys.js";

describe("gateKeysResponse", () => {
  it("serves the configured key set with a short public cache", async () => {
    const { publicKey } = await generateGateKeyPair("k1");
    const response = gateKeysResponse({
      GATE_PUBLIC_KEYS: JSON.stringify({ keys: [publicKey], note: "x" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(GATE_KEYS_CACHE_CONTROL);
    expect(await response.json()).toEqual({ keys: [publicKey] });
  });

  it.each([
    ["unset", undefined],
    ["blank", "  "],
    ["not JSON", "{keys"],
    ["not a key set", JSON.stringify({ keys: [{ kid: "k1", kty: "RSA" }] })],
  ])("answers 404 when GATE_PUBLIC_KEYS is %s", (_label, value) => {
    const response = gateKeysResponse({ GATE_PUBLIC_KEYS: value });
    expect(response.status).toBe(404);
  });
});

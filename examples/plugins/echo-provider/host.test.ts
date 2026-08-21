import { expect, it } from "vitest";
import hostEntry, { experimental_providerBridge } from "./host.js";

/**
 * One artifact, two surfaces. This is the property the shape exists for: the
 * daemon's bridge bootstrap looks for the named bridge export and the host
 * worker looks for the default host entry, so a plugin with both must export
 * both from the same `bb.host` entry without either starting the other.
 */
it("exports a provider bridge and a host RPC entry from one host artifact", () => {
  expect(experimental_providerBridge.experimental_apiVersion).toBe(1);
  expect(typeof experimental_providerBridge.handleLine).toBe("function");
  expect(hostEntry.experimental_apiVersion).toBe(1);
  expect(Object.keys(hostEntry.contract)).toEqual(["hostGreeting"]);
});

import { describe, expect, it } from "vitest";
import { providerHasCommandSurface } from "./provider-command-typeahead.js";

describe("providerHasCommandSurface", () => {
  it("derives command typeahead support from provider-declared skills actions", () => {
    expect(providerHasCommandSurface("codex")).toBe(true);
    expect(providerHasCommandSurface("claude-code")).toBe(true);
    expect(providerHasCommandSurface("pi")).toBe(false);
    expect(providerHasCommandSurface("unknown-provider")).toBe(false);
  });
});

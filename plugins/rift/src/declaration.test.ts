import { describe, expect, it } from "vitest";
import { riftProviderDeclaration } from "./declaration.js";

describe("Rift provider declaration", () => {
  it("keeps remote account authorization explicit", () => {
    const options = riftProviderDeclaration().experimental_bridgeOptions;
    expect(options).not.toHaveProperty("acpAccountAuthorization");
    expect(options).toMatchObject({
      acpClientMeta: {
        "riftar.cc": { accountAuthorization: { version: 1 } },
      },
    });
  });
});

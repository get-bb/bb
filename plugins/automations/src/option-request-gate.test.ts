import { describe, expect, it } from "vitest";
import { OptionRequestGate } from "./option-request-gate.js";

describe("OptionRequestGate", () => {
  it("starts a replacement after a pending request is cancelled", () => {
    const gate = new OptionRequestGate();
    const first = gate.begin("automation:execution");

    expect(first).not.toBeNull();
    expect(gate.begin("automation:execution")).toBeNull();

    first?.cancel();
    const replacement = gate.begin("automation:execution");
    expect(replacement).not.toBeNull();

    // A late completion from the cancelled request must not disturb the
    // replacement request or its eventual cache entry.
    first?.complete();
    replacement?.complete();
    replacement?.cancel();
    expect(gate.begin("automation:execution")).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { randomUuid } from "./random-uuid";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("randomUuid", () => {
  it("makes distinct v4 UUIDs without crypto.randomUUID, as on plain-HTTP origins", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: crypto.getRandomValues.bind(crypto),
      randomUUID: undefined,
    });

    const first = randomUuid();
    const second = randomUuid();

    expect(z.string().uuid().safeParse(first).success).toBe(true);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(second).not.toBe(first);
  });
});

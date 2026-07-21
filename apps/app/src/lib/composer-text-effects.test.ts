import { describe, expect, it } from "vitest";
import {
  getComposerTextEffects,
  setComposerTextEffect,
} from "./composer-text-effects";

describe("composer text effects", () => {
  it("composes owners by plugin id and owner order and removes either independently", () => {
    const storageKey = "composer-effects-composition";
    const alphaFirst = Symbol("alpha-first");
    const alphaSecond = Symbol("alpha-second");
    const zeta = Symbol("zeta");

    setComposerTextEffect(
      storageKey,
      "zeta",
      { className: "zeta-effect" },
      zeta,
      0,
    );
    setComposerTextEffect(
      storageKey,
      "alpha",
      { className: "alpha-second" },
      alphaSecond,
      2,
    );
    setComposerTextEffect(
      storageKey,
      "alpha",
      { className: "alpha-first" },
      alphaFirst,
      1,
    );

    expect(
      getComposerTextEffects(storageKey).map(({ effect }) =>
        typeof effect === "string" ? effect : effect.className,
      ),
    ).toEqual(["alpha-first", "alpha-second", "zeta-effect"]);

    setComposerTextEffect(storageKey, "alpha", null, alphaFirst);
    expect(
      getComposerTextEffects(storageKey).map(({ effect }) =>
        typeof effect === "string" ? effect : effect.className,
      ),
    ).toEqual(["alpha-second", "zeta-effect"]);

    setComposerTextEffect(storageKey, "zeta", null, zeta);
    expect(
      getComposerTextEffects(storageKey).map(({ effect }) =>
        typeof effect === "string" ? effect : effect.className,
      ),
    ).toEqual(["alpha-second"]);
    setComposerTextEffect(storageKey, "alpha", null, alphaSecond);
  });
});

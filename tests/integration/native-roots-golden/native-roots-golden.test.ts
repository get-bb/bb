/**
 * Golden proof for native command/skill roots: for every provider fixture
 * variant, the pipeline's listing on the fixture workspace must equal the
 * golden in `goldens/` (`capture.ts` writes them): the pre-S5 daemon's
 * listing, or the post-S5 one where `fixtures.ts` records a deliberate
 * rule change.
 *
 * `pipeline` is the post-S5 path (declaration, resolver, daemon); the one call site
 * below is what proves before == after. The golden covers roots, names,
 * descriptions and paths, not skill ids (see `golden.ts`): a change to the
 * identity seeds does not fail here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_VARIANTS } from "./fixtures.js";
import { type ApplyEnv, captureVariant, readGolden } from "./golden.js";
import { pipeline } from "./pipeline.js";

const applyStubbedEnv: ApplyEnv = (env) => {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  return () => vi.unstubAllEnvs();
};

describe("native roots golden", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  for (const variant of FIXTURE_VARIANTS) {
    it(`${variant.providerId} (${variant.variant}) lists the golden commands and skills`, async () => {
      const golden = await readGolden(variant);
      const actual = await captureVariant(
        variant,
        pipeline,
        applyStubbedEnv,
      );
      expect(actual).toEqual(golden);
    });
  }
});

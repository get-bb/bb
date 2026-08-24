/**
 * Capture the native-roots goldens from the pipeline in `pipeline.ts`.
 *
 * Run from `tests/integration` (no pnpm needed):
 *   node --conditions=source --import tsx native-roots-golden/capture.ts
 *
 * Pass provider ids to limit the capture, e.g. `... capture.ts codex acp-grok`.
 * Writes `goldens/<provider>[.<variant>].json` and prints per-variant counts.
 * Then format the goldens so `pnpm format:check` stays clean:
 *   pnpm exec prettier --write native-roots-golden/goldens
 */
import { FIXTURE_VARIANTS } from "./fixtures.js";
import {
  applyProcessEnv,
  captureVariant,
  goldenFilePath,
  writeGolden,
} from "./golden.js";
import { pipeline } from "./pipeline.js";

const providerFilter = new Set(process.argv.slice(2));
const variants = FIXTURE_VARIANTS.filter(
  (variant) =>
    providerFilter.size === 0 || providerFilter.has(variant.providerId),
);
if (variants.length === 0) {
  console.error(`No fixture variant matches ${[...providerFilter].join(", ")}`);
  process.exit(1);
}

for (const variant of variants) {
  const golden = await captureVariant(
    variant,
    pipeline,
    applyProcessEnv,
  );
  await writeGolden(variant, golden);
  const counts = (section: typeof golden.workspace): string =>
    `${section.commands.length} commands, ${section.skills.length} skills`;
  console.log(
    `${variant.providerId}.${variant.variant}: workspace ${counts(golden.workspace)}; userOnly ${counts(golden.userOnly)} -> ${goldenFilePath(variant)}`,
  );
}

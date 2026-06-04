import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  appScaffoldTemplateDigestPath,
  computeAppScaffoldTemplateDigest,
  type AppScaffoldTemplateDigest,
} from "../../scripts/app-scaffold-template-digest.mjs";

const REBUILD_COMMAND = "pnpm --filter @bb/server build:app-scaffold-template";

describe("app scaffold template drift", () => {
  // The template vendors two representations of the same app: editable
  // source/ and the prebuilt public/ tree bb serves. The recorded digest pins
  // both, so editing source/ (or regenerating bb-sdk.d.ts) without rebuilding
  // public/ — or rebuilding without recording — fails here instead of
  // shipping a scaffold whose served bundle disagrees with its source.
  it("keeps the committed public/ build in sync with source/", () => {
    const recorded: AppScaffoldTemplateDigest = JSON.parse(
      readFileSync(appScaffoldTemplateDigestPath, "utf8"),
    );
    expect(
      computeAppScaffoldTemplateDigest(),
      `app-scaffold-template source/ or public/ changed without a rebuild. Run: ${REBUILD_COMMAND}`,
    ).toEqual(recorded);
  });
});

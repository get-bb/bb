import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { BUNDLED_PLUGINS } from "../../apps/server/src/services/plugins/builtin-registry.js";
import {
  BUNDLED_MARKETPLACE_FILENAME,
  BUNDLED_MARKETPLACE_GENERATED_DIRECTORY,
} from "../../apps/server/src/services/plugin-catalog/bundled-marketplace-paths.js";

const root = resolve(import.meta.dirname, "../..");
const output = resolve(import.meta.dirname, "dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(
  resolve(
    root,
    "apps/server/src/generated",
    BUNDLED_MARKETPLACE_GENERATED_DIRECTORY,
    BUNDLED_MARKETPLACE_FILENAME,
  ),
  resolve(output, BUNDLED_MARKETPLACE_FILENAME),
);
for (const { name } of BUNDLED_PLUGINS) {
  await cp(
    resolve(root, "plugins", name, ".bundled-runtime"),
    resolve(output, name),
    { recursive: true },
  );
}

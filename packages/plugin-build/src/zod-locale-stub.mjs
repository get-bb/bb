import { dirname, join } from "node:path";

// Plain ESM on purpose, like the sibling runtime-shims.mjs: scripts/build-utils.mjs
// runs under bare `node` and needs the same esbuild plugin, so keeping one
// module is what stops the two build paths from drifting apart. The sibling
// zod-locale-stub.d.mts declares its shape for tsc.
/**
 * zod's entry re-exports its ~49 locale modules as a namespace
 * (`export * as locales`), and the `z` namespace every plugin imports reaches
 * that namespace, so esbuild keeps all of it: 181 KB minified in an app
 * bundle, 257 KB raw in a server or host bundle, per plugin. Rollup shakes it
 * out, which is why apps/app is clean and every esbuild artifact is not.
 *
 * Resolving the barrel to `en` alone is the whole fix. `en` is what zod
 * installs as the default error map, so parse results and messages are
 * unchanged; the only observable difference is that `z.locales` holds one
 * entry instead of 49. A plugin that wants another language imports the
 * locale module directly, which this leaves alone.
 *
 * @returns {import("esbuild").Plugin}
 */

export const ZOD_LOCALE_STUB_NAMESPACE = "bb-zod-locale-stub";
const NAMESPACE = ZOD_LOCALE_STUB_NAMESPACE;
const RESOLVED_MARK = "bb-zod-locale-stub-resolved";
const LOCALE_BARREL_FILTER = /locales[\\/]index\.js$/;
const ZOD_PACKAGE_SEGMENT = /[\\/]zod[\\/]/;

export function zodLocaleStubPlugin() {
  return {
    name: NAMESPACE,
    setup(build) {
      build.onResolve({ filter: LOCALE_BARREL_FILTER }, async (args) => {
        if (args.pluginData === RESOLVED_MARK) return undefined;
        if (!ZOD_PACKAGE_SEGMENT.test(args.importer)) return undefined;
        const resolved = await build.resolve(args.path, {
          importer: args.importer,
          kind: args.kind,
          resolveDir: args.resolveDir,
          pluginData: RESOLVED_MARK,
        });
        if (resolved.errors.length > 0 || resolved.path === "")
          return undefined;
        return { path: resolved.path, namespace: NAMESPACE };
      });
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => ({
        contents: `export { default as en } from ${JSON.stringify(
          join(dirname(args.path), "en.js"),
        )};\n`,
        loader: "js",
        resolveDir: dirname(args.path),
      }));
    },
  };
}

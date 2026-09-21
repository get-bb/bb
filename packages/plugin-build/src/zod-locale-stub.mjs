import { dirname, join } from "node:path";

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

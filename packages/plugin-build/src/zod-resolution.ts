import type { Plugin } from "esbuild";
import { PLUGIN_SDK_PACKAGE_NAME } from "./plugin-sdk-install.js";

const ZOD_FILTER = /^zod($|\/)/;
const RESOLVED_MARK = "bb-zod-resolution-resolved";
const SDK_IMPORTER = /[\\/]@get-bb[\\/]plugin-sdk[\\/]/;

export function describeUnresolvedZod(args: {
  specifier: string;
  importer: string;
  entryKind: "host" | "server";
}): string {
  const viaSdk = SDK_IMPORTER.test(args.importer);
  const cause = viaSdk
    ? `the ${PLUGIN_SDK_PACKAGE_NAME} installation is missing its required zod dependency`
    : `this ${args.entryKind} entry imports it`;
  const remedy = viaSdk
    ? `reinstall ${PLUGIN_SDK_PACKAGE_NAME} before building the plugin`
    : `add zod to the plugin's dependencies`;
  return `could not resolve "${args.specifier}": ${cause}; ${remedy}. Marking zod external instead would leave an unresolvable import in the built bundle.`;
}

export function zodResolutionPlugin(
  entryKind: "host" | "server",
  options: { hostProvidedBareZod?: boolean } = {},
): Plugin {
  return {
    name: "bb-zod-resolution",
    setup(build) {
      build.onResolve({ filter: ZOD_FILTER }, async (args) => {
        if (options.hostProvidedBareZod === true && args.path === "zod") {
          return { path: args.path, external: true };
        }
        if (args.pluginData === RESOLVED_MARK) return undefined;
        const resolved = await build.resolve(args.path, {
          importer: args.importer,
          kind: args.kind,
          resolveDir: args.resolveDir,
          pluginData: RESOLVED_MARK,
        });
        if (resolved.errors.length > 0 || resolved.path === "") {
          return {
            errors: [
              {
                text: describeUnresolvedZod({
                  specifier: args.path,
                  importer: args.importer,
                  entryKind,
                }),
              },
            ],
          };
        }
        return resolved;
      });
    },
  };
}

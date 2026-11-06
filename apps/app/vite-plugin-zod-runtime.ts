import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { normalizePath, type Plugin } from "vite";

export const PLUGIN_ZOD_RUNTIME_ID = "virtual:bb-plugin-zod";
const COPY_PREFIX = "\0bb-plugin-zod:";
const LOCALE_BARREL = /[\\/]zod[\\/].*[\\/]locales[\\/]index\.js$/;

export function pluginZodRuntime(): Plugin {
  let isolate = false;
  return {
    name: "bb:plugin-zod-runtime",
    enforce: "pre",
    configResolved(config) {
      isolate = config.command === "build";
    },
    async resolveId(source, importer, options) {
      const copied = importer?.startsWith(COPY_PREFIX) === true;
      if (source !== PLUGIN_ZOD_RUNTIME_ID && !copied) return null;
      const target = source === PLUGIN_ZOD_RUNTIME_ID ? "zod" : source;
      const from = copied ? importer?.slice(COPY_PREFIX.length) : importer;
      const resolved = await this.resolve(target, from, {
        ...options,
        skipSelf: true,
      });
      if (resolved === null || resolved.external || !isolate) return resolved;
      return `${COPY_PREFIX}${resolved.id}`;
    },
    async load(id) {
      if (!id.startsWith(COPY_PREFIX)) return null;
      const path = id.slice(COPY_PREFIX.length);
      if (LOCALE_BARREL.test(path)) {
        return {
          code: `export { default as en } from ${JSON.stringify(normalizePath(join(dirname(path), "en.js")))};\n`,
          moduleType: "js",
        };
      }
      return { code: await readFile(path, "utf8"), moduleType: "js" };
    },
  };
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import type { Plugin, PluginOption } from "vite";
import { z } from "zod";

const appDir = dirname(fileURLToPath(import.meta.url));
const sourceMapSchema = z.object({
  version: z.literal(3),
  sources: z.array(z.string().nullable()),
  names: z.array(z.string()),
  mappings: z.string(),
});
const cachedTransformSchema = z.object({
  code: z.string(),
  map: z
    .string()
    .refine((value) => {
      try {
        return sourceMapSchema.safeParse(JSON.parse(value)).success;
      } catch {
        return false;
      }
    })
    .nullable(),
});

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function cachedReactCompiler(): Promise<PluginOption[]> {
  const compiler = await babel({ presets: [reactCompilerPreset()] });
  const hook = compiler.transform;
  if (hook === undefined || typeof hook === "function") {
    throw new Error("React Compiler must expose a filtered transform hook");
  }
  const transform = hook.handler;
  let cache: { directory: string; fingerprint: string } | null = null;

  hook.handler = async function (code, id, options) {
    if (cache === null) return transform.call(this, code, id, options);
    const key = hash(
      JSON.stringify([
        cache.fingerprint,
        this.environment?.name,
        id,
        options,
        code,
      ]),
    );
    const target = join(cache.directory, `${key}.json`);
    try {
      const parsed = cachedTransformSchema.safeParse(
        JSON.parse(await readFile(target, "utf8")),
      );
      if (parsed.success) return parsed.data;
    } catch {}

    const result = await transform.call(this, code, id, options);
    if (
      result !== null &&
      typeof result === "object" &&
      typeof result.code === "string" &&
      Object.keys(result).every((key) => key === "code" || key === "map")
    ) {
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(
          temporary,
          JSON.stringify({
            code: result.code,
            map:
              result.map == null
                ? null
                : typeof result.map === "string"
                  ? result.map
                  : JSON.stringify(result.map),
          }),
        );
        await rename(temporary, target);
      } catch {
        await rm(temporary, { force: true }).catch(() => {});
      }
    }
    return result;
  };

  return [
    compiler,
    {
      name: "bb:react-compiler-cache",
      async configResolved(config) {
        if (config.command !== "build") return;
        const inputs = await Promise.all(
          [
            resolve(appDir, "../../pnpm-lock.yaml"),
            join(appDir, "vite.config.ts"),
            join(appDir, "vite-react-compiler.ts"),
          ].map((file) => readFile(file, "utf8")),
        );
        const directory = join(config.cacheDir, "react-compiler");
        try {
          await mkdir(directory, { recursive: true });
          cache = {
            directory,
            fingerprint: hash(
              JSON.stringify([
                inputs,
                process.version,
                process.env.NODE_ENV,
                process.env.BABEL_ENV,
                config.mode,
                config.isProduction,
              ]),
            ),
          };
        } catch {}
      },
    } satisfies Plugin,
  ];
}

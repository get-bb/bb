import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type {
  AcpNativeRootsEnvironment,
  AcpNativeRootsResolver,
} from "./resolver.js";
import {
  configuredSkillRoot,
  readParsedFile,
  resolveConfiguredPath,
  resolveStoredPath,
  skillsRoot,
} from "./shared.js";

const HERMES_DIR_NAME = ".hermes";

const hermesSkillConfigSchema = z
  .object({
    skills: z
      .object({
        external_dirs: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .transform((value) =>
            value === undefined ? [] : Array.isArray(value) ? value : [value],
          ),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function resolveHermesDir(
  homeDir: string,
  env: AcpNativeRootsEnvironment,
): string {
  const configured = env.HERMES_HOME?.trim();
  return configured
    ? resolveStoredPath(homeDir, configured)
    : path.join(homeDir, HERMES_DIR_NAME);
}

export const resolveHermesNativeRoots: AcpNativeRootsResolver = async (
  args,
) => {
  const hermesDir = resolveHermesDir(args.homeDir, args.env);
  const config = await readParsedFile(
    path.join(hermesDir, "config.yaml"),
    parseYaml,
    hermesSkillConfigSchema,
  );
  const externalDirectories = config?.skills?.external_dirs ?? [];
  return {
    skills: [
      skillsRoot({
        origin: "user",
        path: path.join(hermesDir, "skills"),
        recursive: true,
      }),
      ...externalDirectories.map((configuredPath) =>
        configuredSkillRoot({
          origin: "user",
          recursive: true,
          skillPath: resolveConfiguredPath({
            basePath: hermesDir,
            env: args.env,
            homeDir: args.homeDir,
            value: configuredPath,
          }),
        }),
      ),
    ],
  };
};

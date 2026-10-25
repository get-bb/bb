import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import type { AcpNativeRootsResolver } from "./resolver.js";
import {
  readParsedFile,
  resolveProjectAncestorDirectories,
  resolveStoredPath,
  skillsRoot,
} from "./shared.js";

const kimiSkillConfigSchema = z
  .object({
    extra_skill_dirs: z.array(z.string()).optional(),
    extraSkillDirs: z.array(z.string()).optional(),
  })
  .passthrough();

export const resolveKimiNativeRoots: AcpNativeRootsResolver = async (args) => {
  const cwd = args.cwd ?? args.homeDir;
  const kimiHome = path.resolve(
    cwd,
    args.env.KIMI_CODE_HOME ?? path.join(args.homeDir, ".kimi-code"),
  );
  const projectRoot =
    args.cwd === null
      ? null
      : (await resolveProjectAncestorDirectories(args.cwd)).projectRootPath;
  const config = await readParsedFile(
    path.join(kimiHome, "config.toml"),
    parseToml,
    kimiSkillConfigSchema,
  );
  const extraDirectories =
    config?.extra_skill_dirs ?? config?.extraSkillDirs ?? [];
  return {
    skills: [
      ...[
        path.join(kimiHome, "skills"),
        path.join(args.homeDir, ".agents", "skills"),
        ...extraDirectories.map((directory) =>
          directory === "~" || directory.startsWith("~/")
            ? resolveStoredPath(args.homeDir, directory)
            : path.resolve(projectRoot ?? args.homeDir, directory),
        ),
      ].map((rootPath) =>
        skillsRoot({ origin: "user", path: rootPath, recursive: true }),
      ),
      ...(projectRoot === null
        ? []
        : [".kimi-code", ".agents"].map((directory) =>
            skillsRoot({
              origin: "project",
              path: path.join(projectRoot, directory, "skills"),
              recursive: true,
            }),
          )),
    ],
  };
};

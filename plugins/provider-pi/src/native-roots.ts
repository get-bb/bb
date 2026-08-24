/**
 * The pi plugin's native skill roots: the declared layout pi documents, and
 * the plugin's answer to `resolveNativeRoots` for the roots only one host
 * knows.
 *
 * The declaration in {@link PI_NATIVE_ROOTS_DECLARATION} names the default
 * directories (`~/.pi/agent/skills` and `~/.agents/skills` at home,
 * `.pi/skills` and `.agents/skills` in the workspace). The resolver reads
 * what pi's own files on this host add, from the files rather than pi's SDK:
 * `<agentDir>/settings.json`'s `skills` entries (plain paths — absolute,
 * `~`-relative, or relative to the agent dir — each a skill directory), plus
 * the agent dir's own `skills` directory when `PI_CODING_AGENT_DIR` moved it
 * away from the declared `~/.pi/agent`. Every resolved root is `user` origin:
 * the workspace does not change the answer, so `cwd` is not needed here.
 *
 * Not listed, by design (see README): skills pi loads from `packages`
 * (npm/git installs pi manages itself), `!pattern` disable entries, single
 * `SKILL.md` file entries (no directory root to scan), and the trusted
 * project's `.pi/settings.json` entries.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  experimental_filterResolvedNativeRoots,
  type ExperimentalNativeRootsResolveAnswer,
} from "@get-bb/plugin-sdk/host";
import { z } from "zod";

/**
 * The declared side of pi's skill roots, spread into the provider
 * declaration and imported by the golden proof to run the declaration and
 * the resolver together. Pi has no native slash commands. The host-only
 * roots come from {@link resolvePiNativeRoots}, which the
 * `experimental_resolvesNativeRoots` flag tells bb to call.
 */
export const PI_NATIVE_ROOTS_DECLARATION: Pick<
  PluginProviderDeclaration,
  "experimental_nativeSkillRoots" | "experimental_resolvesNativeRoots"
> = {
  experimental_nativeSkillRoots: {
    // The default agent dir is declared; a PI_CODING_AGENT_DIR that moved it
    // arrives from the resolver beside it.
    user: [".pi/agent/skills", ".agents/skills"],
    project: [".pi/skills", ".agents/skills"],
  },
  experimental_resolvesNativeRoots: true,
};

const piSettingsSchema = z
  .object({ skills: z.array(z.string()).optional() })
  .passthrough();

const DEFAULT_AGENT_DIR_SEGMENTS = [".pi", "agent"] as const;

export interface ResolvePiNativeRootsArgs {
  /** The host user's home directory (`os.homedir()`). */
  homeDir: string;
  /** The host daemon's environment; `PI_CODING_AGENT_DIR` moves the agent dir. */
  env: Readonly<Record<string, string | undefined>>;
}

function resolvePiAgentDir(args: ResolvePiNativeRootsArgs): string {
  const configured = args.env.PI_CODING_AGENT_DIR?.trim();
  return configured
    ? resolveStoredPath(args.homeDir, configured, args.homeDir)
    : path.join(args.homeDir, ...DEFAULT_AGENT_DIR_SEGMENTS);
}

function resolveStoredPath(homeDir: string, value: string, baseDir: string): string {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

/** Pi package sources (`npm:`, `git:`, URLs) are not paths anyone can scan. */
function isPlainSkillSource(value: string): boolean {
  return !/^(?:npm:|git:|https?:\/\/|git@)/u.test(value);
}

/**
 * The skill directories pi's user settings on this host name, as resolved
 * user roots, sorted by path. Never throws: an unreadable or absent settings
 * file adds nothing. Each root is `path.resolve`d, so it is absolute without
 * dot segments; the contract filter is the safety net for anything else and
 * drops it with a warning on the host worker's stderr (the daemon logs it).
 */
export async function resolvePiNativeRoots(
  args: ResolvePiNativeRootsArgs,
): Promise<ExperimentalNativeRootsResolveAnswer> {
  const agentDir = resolvePiAgentDir(args);
  const roots = new Set<string>();
  if (agentDir !== path.join(args.homeDir, ...DEFAULT_AGENT_DIR_SEGMENTS)) {
    roots.add(path.resolve(agentDir, "skills"));
  }
  let settings: z.infer<typeof piSettingsSchema> | null = null;
  try {
    settings = piSettingsSchema.parse(
      JSON.parse(await readFile(path.join(agentDir, "settings.json"), "utf8")),
    );
  } catch {
    settings = null;
  }
  for (const raw of settings?.skills ?? []) {
    const value = raw.trim();
    if (value.length === 0 || value.startsWith("!") || !isPlainSkillSource(value)) {
      continue;
    }
    // A root is a directory of skills. An entry naming one `.md` file (a
    // `SKILL.md`, or any other markdown file pi accepts as a single skill)
    // has no directory root to scan (pi loads it; bb does not list it — see
    // README).
    if (path.extname(value).toLowerCase() === ".md") {
      continue;
    }
    // `path.resolve` drops a trailing separator that `normalize` keeps, which
    // would otherwise read as an empty last segment and lose the entry.
    roots.add(path.resolve(resolveStoredPath(args.homeDir, value, agentDir)));
  }
  return {
    skills: experimental_filterResolvedNativeRoots(
      {
        skills: [...roots]
          .sort()
          .map((rootPath) => ({ path: rootPath, origin: "user" as const, shape: "skills" as const })),
      },
      { warn: console.warn },
    ).answer.skills,
  };
}

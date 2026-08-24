import { z } from "zod";
import {
  isAbsoluteProviderSkillRootPath,
  isRelativeProviderSkillRootPath,
} from "./provider-skill-roots.js";

/**
 * Provider-native roots: the directories a provider's own agent reads skills
 * and slash commands from. A plugin declares them (relative to the target
 * host's home — `user` — or to the workspace — `project`) and resolves the
 * host-absolute ones per host and workspace through its `bb.host` entry. The
 * daemon scans exactly these; core never guesses a layout.
 *
 * Two forms. The INPUT form is what a plugin writes: a bare path or an object
 * with options. The NORMALIZED form carries every option explicitly; the
 * server fills the defaults once at its boundary and the daemon parses only
 * the normalized form off the wire.
 */

/** Most roots one side of one declaration may name. */
export const PROVIDER_NATIVE_ROOTS_MAX = 32;

/**
 * A non-empty prefix prepended to every command or skill name under the root
 * (a vendor plugin's `plugin-name:`), or empty for none. A prefixed root is a
 * plugin root: the Skills page classifies it as such.
 */
const PROVIDER_NATIVE_ROOT_NAME_PREFIX_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}:$/u;

const nativeRootNamePrefixSchema = z
  .string()
  .refine(
    (value) =>
      value === "" || PROVIDER_NATIVE_ROOT_NAME_PREFIX_PATTERN.test(value),
    "A root name prefix is a plugin-name-like token ending in ':'",
  );

/**
 * A file, relative to a skill directory, that marks the directory as a
 * vendor plugin rather than a skill (Claude's `.claude-plugin/plugin.json`):
 * the daemon skips such a directory when it scans the root for skills. The
 * plugin that knows the vendor layout declares it; the daemon names no vendor.
 */
const nativeRootManifestPathSchema = z
  .string()
  .min(1)
  .refine(
    isRelativeProviderSkillRootPath,
    "A manifest marker is a relative path without dot segments",
  );

const relativeNativeRootPathSchema = z
  .string()
  .min(1)
  .refine(
    isRelativeProviderSkillRootPath,
    "Roots must be relative paths without dot segments",
  );

/** A resolved root's path: what a plugin's host entry found on the host. */
const absoluteNativeRootPathSchema = z
  .string()
  .min(1)
  .refine(
    isAbsoluteProviderSkillRootPath,
    "Absolute roots must be absolute paths without dot segments",
  );

/** Input-form entry: a path, or a path with options. */
export const providerNativeRootInputSchema = z.union([
  z.string().min(1),
  z
    .object({
      path: z.string().min(1),
      /** Skills nest in subdirectories (the agent scans recursively). */
      recursive: z.boolean().optional(),
      /**
       * Scan the same relative directory in every ancestor of the workspace
       * up to the repository root (`project` roots only).
       */
      ancestors: z.boolean().optional(),
      /**
       * Prepended to every name under the root, a vendor plugin's
       * `plugin-name:`; a prefixed root is listed as a plugin root.
       */
      namePrefix: nativeRootNamePrefixSchema.optional(),
      /**
       * A file, relative to a skill directory under this root, that marks the
       * directory as a vendor plugin rather than a skill (Claude's
       * `.claude-plugin/plugin.json`): bb skips such a directory. The plugin
       * that knows the vendor layout declares it; core names no vendor path.
       */
      skipIfManifest: nativeRootManifestPathSchema.optional(),
    })
    .strict(),
]);
/**
 * One provider-native root as a plugin declares it: a path, or a path with
 * options. `recursive`: the agent scans nested skill directories. `ancestors`
 * (project roots only): scan the same relative directory in every ancestor of
 * the workspace up to the repository root. `namePrefix`: prepended to every
 * name under the root, a vendor plugin's `plugin-name:`; a prefixed root is
 * listed as a plugin root. `skipIfManifest`: a vendor-plugin marker file to
 * skip by.
 */
export type ProviderNativeRootInput = z.infer<
  typeof providerNativeRootInputSchema
>;

export const providerNativeRootsInputSchema = z
  .object({
    user: z.array(providerNativeRootInputSchema).optional(),
    project: z.array(providerNativeRootInputSchema).optional(),
  })
  .strict();

/** Normalized entry: every option explicit. */
export const providerNativeRootSchema = z
  .object({
    path: z.string().min(1),
    recursive: z.boolean(),
    ancestors: z.boolean(),
    namePrefix: nativeRootNamePrefixSchema,
    /** Absent: every skill-shaped directory under the root is a skill. */
    skipIfManifest: nativeRootManifestPathSchema.optional(),
  })
  .strict();
export type ProviderNativeRoot = z.infer<typeof providerNativeRootSchema>;

function uniqueByPath<T extends { path: string }>(
  roots: readonly T[],
): boolean {
  return new Set(roots.map((root) => root.path)).size === roots.length;
}

function nativeRootSideSchema(side: "user" | "project") {
  return z
    .array(
      providerNativeRootSchema
        .extend({ path: relativeNativeRootPathSchema })
        .superRefine((root, context) => {
          if (root.ancestors && side !== "project") {
            context.addIssue({
              code: "custom",
              message: "Only project roots may walk ancestors",
            });
          }
        }),
    )
    .max(PROVIDER_NATIVE_ROOTS_MAX)
    .refine(uniqueByPath, "Roots must not repeat a path");
}

/**
 * Normalized roots: relative to the host home (`user`) or to the workspace
 * (`project`). The daemon parses this off the wire; the server produces it
 * from a declaration.
 */
export const providerNativeRootsSchema = z
  .object({
    user: nativeRootSideSchema("user"),
    project: nativeRootSideSchema("project"),
  })
  .strict();
export type ProviderNativeRoots = z.infer<typeof providerNativeRootsSchema>;

export const EMPTY_PROVIDER_NATIVE_ROOTS: ProviderNativeRoots = Object.freeze({
  user: Object.freeze([]) as readonly ProviderNativeRoot[] as ProviderNativeRoot[],
  project: Object.freeze([]) as readonly ProviderNativeRoot[] as ProviderNativeRoot[],
});

/** Fill an input-form entry's defaults. */
export function normalizeProviderNativeRoot(
  entry: ProviderNativeRootInput,
): ProviderNativeRoot {
  if (typeof entry === "string") {
    return { path: entry, recursive: false, ancestors: false, namePrefix: "" };
  }
  return {
    path: entry.path,
    recursive: entry.recursive ?? false,
    ancestors: entry.ancestors ?? false,
    namePrefix: entry.namePrefix ?? "",
    ...(entry.skipIfManifest === undefined
      ? {}
      : { skipIfManifest: entry.skipIfManifest }),
  };
}

/**
 * Provider-native roots as a plugin's frozen declaration holds them: relative
 * to the target host's home (`user`) or to the workspace (`project`). Paths
 * are relative without dot segments, unique per side, at most 32 per side. A
 * root only one host can name — a moved config directory, a settings entry —
 * is the resolver's answer (`resolveNativeRoots`), never a declared root.
 */
export interface ProviderNativeRootsInputLike {
  readonly user?: readonly ProviderNativeRootInput[];
  readonly project?: readonly ProviderNativeRootInput[];
}

/** Fill an input-form declaration's defaults; the result still needs the wire schema's rules. */
export function normalizeProviderNativeRoots(
  roots: ProviderNativeRootsInputLike | undefined,
): ProviderNativeRoots {
  return {
    user: (roots?.user ?? []).map(normalizeProviderNativeRoot),
    project: (roots?.project ?? []).map(normalizeProviderNativeRoot),
  };
}

export function providerNativeRootsAreEmpty(
  roots: ProviderNativeRoots,
): boolean {
  return roots.user.length === 0 && roots.project.length === 0;
}

/**
 * How a resolved root is laid out. `skills`: a directory of skill directories
 * (the default for skills; `recursive` nests). `skill`: the directory is one
 * skill (holds SKILL.md). `skill-file`: a SKILL.md path. `commands`: a flat
 * directory of `*.md` prompt files (the default for commands).
 * `command-file`: one `*.md` file.
 */
export const providerResolvedNativeRootShapeSchema = z.enum([
  "skills",
  "skill",
  "skill-file",
  "commands",
  "command-file",
]);
export type ProviderResolvedNativeRootShape = z.infer<
  typeof providerResolvedNativeRootShapeSchema
>;

/**
 * The fields of a root a plugin resolved on one host for one workspace
 * (`resolveNativeRoots`): host-absolute, with its origin decided by the plugin
 * (a project-scoped vendor plugin is `project`; a home-directory config entry
 * is `user`). The input form makes the options optional; the normalized form
 * adds the cross-field rules.
 */
const resolvedNativeRootFieldsSchema = z
  .object({
    path: absoluteNativeRootPathSchema,
    origin: z.enum(["user", "project"]),
    recursive: z.boolean(),
    /** Only with origin `project`, for a path inside the workspace. */
    ancestors: z.boolean(),
    namePrefix: nativeRootNamePrefixSchema,
    shape: providerResolvedNativeRootShapeSchema,
    /**
     * `skill-file` only: the skill name when the file's frontmatter names
     * none. A vendor plugin's root SKILL.md takes the plugin's name; absent
     * means the parent directory's name.
     */
    fallbackName: z.string().min(1).optional(),
    /**
     * `skills` only: a file, relative to a skill directory under this root,
     * that marks the directory as a vendor plugin rather than a skill; the
     * daemon skips such a directory (see the declared root's `skipIfManifest`).
     */
    skipIfManifest: nativeRootManifestPathSchema.optional(),
  })
  .strict();

/** A resolved root with every option explicit and the cross-field rules applied. */
export const providerResolvedNativeRootSchema =
  resolvedNativeRootFieldsSchema.superRefine((root, context) => {
    if (root.skipIfManifest !== undefined && root.shape !== "skills") {
      context.addIssue({
        code: "custom",
        message: "Only a skills root carries a manifest marker",
      });
    }
    if (root.ancestors && root.origin !== "project") {
      context.addIssue({
        code: "custom",
        message: "Only project roots may walk ancestors",
      });
    }
    if (root.fallbackName !== undefined && root.shape !== "skill-file") {
      context.addIssue({
        code: "custom",
        message: "Only a skill-file root carries a fallback name",
      });
    }
  });
export type ProviderResolvedNativeRoot = z.infer<
  typeof providerResolvedNativeRootSchema
>;

/** The input form a resolver writes: the options optional, filled per side by the normalizer. */
export const providerResolvedNativeRootInputSchema =
  resolvedNativeRootFieldsSchema.partial({
    recursive: true,
    ancestors: true,
    namePrefix: true,
    shape: true,
  });
export type ProviderResolvedNativeRootInput = z.input<
  typeof providerResolvedNativeRootInputSchema
>;

/**
 * Fill one resolved root's defaults for its side (`shape` defaults to the
 * side's directory shape). The commands side carries no manifest marker: a
 * well-formed marker given there is dropped rather than refused, while a
 * malformed one is refused on either side by
 * `providerResolvedNativeRootInputSchema`, which runs first.
 */
export function normalizeProviderResolvedNativeRoot(
  root: ProviderResolvedNativeRootInput,
  side: keyof ProviderResolvedNativeRoots,
): ProviderResolvedNativeRoot {
  return {
    path: root.path,
    origin: root.origin,
    recursive: root.recursive ?? false,
    ancestors: root.ancestors ?? false,
    namePrefix: root.namePrefix ?? "",
    shape: root.shape ?? (side === "skills" ? "skills" : "commands"),
    ...(root.fallbackName === undefined
      ? {}
      : { fallbackName: root.fallbackName }),
    ...(side === "skills" && root.skipIfManifest !== undefined
      ? { skipIfManifest: root.skipIfManifest }
      : {}),
  };
}

const resolvedSkillShapes = new Set<ProviderResolvedNativeRootShape>([
  "skills",
  "skill",
  "skill-file",
]);
const resolvedCommandShapes = new Set<ProviderResolvedNativeRootShape>([
  "commands",
  "command-file",
]);

/** Resolved roots, skills and commands apart; the largest payload a resolver may return. */
export const PROVIDER_RESOLVED_NATIVE_ROOTS_MAX = 256;

export const providerResolvedNativeRootsSchema = z
  .object({
    skills: z
      .array(
        providerResolvedNativeRootSchema.refine(
          (root) => resolvedSkillShapes.has(root.shape),
          "A skills root needs a skill shape",
        ),
      )
      .max(PROVIDER_RESOLVED_NATIVE_ROOTS_MAX),
    commands: z
      .array(
        providerResolvedNativeRootSchema.refine(
          (root) => resolvedCommandShapes.has(root.shape),
          "A commands root needs a command shape",
        ),
      )
      .max(PROVIDER_RESOLVED_NATIVE_ROOTS_MAX),
  })
  .strict();
export type ProviderResolvedNativeRoots = z.infer<
  typeof providerResolvedNativeRootsSchema
>;

export const EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS: ProviderResolvedNativeRoots =
  Object.freeze({
    skills: Object.freeze([]) as readonly ProviderResolvedNativeRoot[] as ProviderResolvedNativeRoot[],
    commands: Object.freeze([]) as readonly ProviderResolvedNativeRoot[] as ProviderResolvedNativeRoot[],
  });

/**
 * Everything the daemon scans for one provider on one host: the declared
 * skill and command roots and what the plugin resolved for this workspace.
 */
export const providerNativeRootSetSchema = z
  .object({
    skills: providerNativeRootsSchema,
    commands: providerNativeRootsSchema,
    resolved: providerResolvedNativeRootsSchema,
  })
  .strict();
export type ProviderNativeRootSet = z.infer<typeof providerNativeRootSetSchema>;

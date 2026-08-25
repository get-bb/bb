/**
 * The host RPC a provider plugin implements when its declaration sets
 * `experimental_resolvesNativeRoots`. Core calls `resolveNativeRoots` on the
 * workspace host each time it lists a provider's commands or skills (cached
 * briefly per host and workspace) and scans the returned roots beside the
 * declared ones. The plugin answers from the host's own files — a moved
 * config directory, installed vendor plugins, config-file skill entries —
 * and decides each root's origin: a project-scoped vendor plugin is
 * `project`, a home-directory entry is `user`.
 *
 * Paths are host-absolute without dot segments. A root's `shape` says how the
 * daemon reads it; the defaults (`skills` for the skills side, `commands` for
 * the commands side) are filled by the contract. A thrown error or a
 * malformed answer is logged by core and yields no resolved roots for that
 * listing; it never fails the listing. A side longer than
 * `PROVIDER_RESOLVED_NATIVE_ROOTS_MAX` is cut to the cap, not refused.
 *
 * The contract validates the whole answer at once, so one root the contract
 * refuses (a vendor plugin whose name cannot be a name prefix, say) would
 * cost the user every other root. A resolver runs its answer through
 * `experimental_filterResolvedNativeRoots` before it returns: each root is
 * judged on its own, a refused one is dropped with a warning, and the rest
 * stand.
 */
import { z } from "zod";
import {
  PROVIDER_RESOLVED_NATIVE_ROOTS_MAX,
  normalizeProviderResolvedNativeRoot,
  providerResolvedNativeRootInputSchema,
  providerResolvedNativeRootsSchema,
  type ProviderResolvedNativeRootInput,
  type ProviderResolvedNativeRoots,
} from "@bb/domain";
import { defineRpcContract } from "./rpc-contract.js";

export const experimental_nativeRootsResolveInputSchema = z
  .object({
    /**
     * The provider being listed. One plugin may register several providers
     * (the ACP plugin registers one per agent) from one host entry.
     */
    providerId: z.string().min(1),
    /** The workspace, or null when bb lists without one (user roots only). */
    cwd: z.string().min(1).nullable(),
  })
  .strict();
export type ExperimentalNativeRootsResolveInput = z.infer<
  typeof experimental_nativeRootsResolveInputSchema
>;

type ResolvedRootSide = keyof ProviderResolvedNativeRoots;

/** What a resolver returns: the normalized roots, defaults filled per side, each side cut to the cap. */
export const experimental_nativeRootsResolveOutputSchema = z
  .object({
    skills: z.array(providerResolvedNativeRootInputSchema).optional(),
    commands: z.array(providerResolvedNativeRootInputSchema).optional(),
  })
  .strict()
  .transform((value) => ({
    skills: (value.skills ?? [])
      .slice(0, PROVIDER_RESOLVED_NATIVE_ROOTS_MAX)
      .map((root) => normalizeProviderResolvedNativeRoot(root, "skills")),
    commands: (value.commands ?? [])
      .slice(0, PROVIDER_RESOLVED_NATIVE_ROOTS_MAX)
      .map((root) => normalizeProviderResolvedNativeRoot(root, "commands")),
  }))
  .pipe(providerResolvedNativeRootsSchema);
export type ExperimentalNativeRootsResolveOutput = ProviderResolvedNativeRoots;
/** The input form a handler writes (options optional). */
export type ExperimentalNativeRootsResolveAnswer = z.input<
  typeof experimental_nativeRootsResolveOutputSchema
>;

/** One root `experimental_filterResolvedNativeRoots` refused, and why. */
export interface ExperimentalDroppedNativeRoot {
  side: ResolvedRootSide;
  path: string;
  reason: string;
}

export interface ExperimentalFilteredNativeRoots<
  Skill extends ProviderResolvedNativeRootInput,
  Command extends ProviderResolvedNativeRootInput,
> {
  /** The roots that passed, each side cut to the cap, in the order given. */
  answer: { skills: Skill[]; commands: Command[] };
  dropped: ExperimentalDroppedNativeRoot[];
  /** How many roots the cap cut from each side. */
  truncated: { skills: number; commands: number };
}

function describeIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) =>
      issue.path.length === 0
        ? issue.message
        : `${issue.path.map(String).join(".")}: ${issue.message}`,
    )
    .join("; ");
}

function filterResolvedRootSide<Root extends ProviderResolvedNativeRootInput>(
  side: ResolvedRootSide,
  roots: readonly Root[],
  dropped: ExperimentalDroppedNativeRoot[],
  warn: (message: string) => void,
  warned: Set<string>,
): { kept: Root[]; truncated: number } {
  // The domain's per-root schema plus this side's shape rule, as the server
  // boundary applies them, so what passes here passes there.
  const rootSchema = providerResolvedNativeRootsSchema.shape[side].element;
  const kept: Root[] = [];
  for (const root of roots) {
    // The original object is what the answer carries, so the original must
    // pass: the strict input shape first (an unknown key such as `source`
    // would fail the contract's strict output schema and void the whole
    // answer), then the domain's per-root rules on the normalized form.
    const shape = providerResolvedNativeRootInputSchema.safeParse(root);
    const result = shape.success
      ? rootSchema.safeParse(normalizeProviderResolvedNativeRoot(root, side))
      : shape;
    if (result.success) {
      kept.push(root);
      continue;
    }
    const reason = describeIssues(result.error.issues);
    dropped.push({ side, path: root.path, reason });
    warnOnce(
      warned,
      warn,
      `${side}\u0000${root.path}\u0000${reason}`,
      `resolveNativeRoots: dropped the ${side} root "${root.path}": ${reason}`,
    );
  }
  if (kept.length <= PROVIDER_RESOLVED_NATIVE_ROOTS_MAX) {
    return { kept, truncated: 0 };
  }
  const truncated = kept.length - PROVIDER_RESOLVED_NATIVE_ROOTS_MAX;
  warnOnce(
    warned,
    warn,
    `${side}\u0000truncated\u0000${kept.length}`,
    `resolveNativeRoots: kept the first ${PROVIDER_RESOLVED_NATIVE_ROOTS_MAX} of ${kept.length} ${side} roots; dropped ${truncated} from "${kept[PROVIDER_RESOLVED_NATIVE_ROOTS_MAX]?.path}" on`,
  );
  return { kept: kept.slice(0, PROVIDER_RESOLVED_NATIVE_ROOTS_MAX), truncated };
}

/**
 * A persistent bad root would warn on every listing (about three lines every
 * ten seconds per open workspace) and exhaust the host worker's diagnostic
 * line budget, silencing later diagnostics. Each (side, path, reason) warns
 * once per `warned` set — the worker's lifetime by default.
 */
const warnedForWorker = new Set<string>();

function warnOnce(
  warned: Set<string>,
  warn: (message: string) => void,
  key: string,
  message: string,
): void {
  if (warned.has(key)) return;
  warned.add(key);
  warn(message);
}

/**
 * Judge each root of an answer on its own against the contract, drop the
 * ones it refuses, and cut each side to `PROVIDER_RESOLVED_NATIVE_ROOTS_MAX`
 * (the first roots stay). `warn` is called once per dropped root and once
 * per cut side, with the path and the reason — once for the worker's
 * lifetime per (side, path, reason), so a persistent bad root does not flood
 * the host diagnostics. A resolver calls this on its
 * answer before it returns, so one odd vendor plugin cannot void the listing.
 * The reason lists the field-level issues when any field is malformed; the
 * cross-field rules are judged only on a root whose fields all parse.
 */
export function experimental_filterResolvedNativeRoots<
  Skill extends ProviderResolvedNativeRootInput,
  Command extends ProviderResolvedNativeRootInput,
>(
  answer: {
    readonly skills?: readonly Skill[];
    readonly commands?: readonly Command[];
  },
  options: {
    warn: (message: string) => void;
    /** Warned (side, path, reason) keys; defaults to a set that lives as long as the worker. */
    warned?: Set<string>;
  },
): ExperimentalFilteredNativeRoots<Skill, Command> {
  const dropped: ExperimentalDroppedNativeRoot[] = [];
  const warned = options.warned ?? warnedForWorker;
  const skills = filterResolvedRootSide(
    "skills",
    answer.skills ?? [],
    dropped,
    options.warn,
    warned,
  );
  const commands = filterResolvedRootSide(
    "commands",
    answer.commands ?? [],
    dropped,
    options.warn,
    warned,
  );
  return {
    answer: { skills: skills.kept, commands: commands.kept },
    dropped,
    truncated: { skills: skills.truncated, commands: commands.truncated },
  };
}

export const experimental_nativeRootsHostContract = defineRpcContract({
  resolveNativeRoots: {
    input: experimental_nativeRootsResolveInputSchema,
    output: experimental_nativeRootsResolveOutputSchema,
  },
});
export type ExperimentalNativeRootsHostContract =
  typeof experimental_nativeRootsHostContract;

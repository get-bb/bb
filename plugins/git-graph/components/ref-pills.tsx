import type { GitRef } from "../contract.js";

export type RefChipKind =
  | "head"
  | "detached"
  | "branch"
  | "remote"
  | "tag"
  | "stash"
  | "other";

export interface RefChip {
  key: string;
  kind: RefChipKind;
  label: string;
  remotes: readonly string[];
  title: string;
}

export const MAX_REF_CHIPS = 3;
const REF_CHIP_MIN_WIDTH = 72;
const REF_CHIPS_WIDTH_SHARE = 0.6;

const CHIP_BASE_CLASS =
  "inline-flex h-4 min-w-0 max-w-40 shrink items-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border px-1 text-xs leading-none";

const OUTLINE_CHIP_CLASS =
  "border-[color:color-mix(in_oklab,var(--gg-ref)_45%,transparent)] bg-[color:color-mix(in_oklab,var(--gg-ref)_13%,transparent)] font-medium text-[color:color-mix(in_oklab,var(--gg-ref)_72%,var(--foreground))]";

const FILLED_CHIP_CLASS =
  "border-transparent bg-[color:color-mix(in_oklab,var(--gg-ref)_80%,var(--foreground))] font-semibold text-background";

const OVERFLOW_CHIP_CLASS =
  "shrink-0 border-border bg-muted font-medium text-muted-foreground";

const KIND_TONE_CLASS: Record<RefChipKind, string> = {
  head: "[--gg-ref:#10b981]",
  detached: "[--gg-ref:var(--foreground)]",
  branch: "[--gg-ref:#10b981]",
  remote: "[--gg-ref:#0ea5e9]",
  tag: "[--gg-ref:#f59e0b]",
  stash: "[--gg-ref:#d946ef]",
  other: "[--gg-ref:var(--muted-foreground)]",
};

export function refChipLimit(descriptionWidth: number | null): number {
  if (descriptionWidth === null) return MAX_REF_CHIPS;
  const fit = Math.floor(
    (descriptionWidth * REF_CHIPS_WIDTH_SHARE) / REF_CHIP_MIN_WIDTH,
  );
  return Math.min(MAX_REF_CHIPS, Math.max(1, fit));
}

function chipKind(ref: GitRef): RefChipKind {
  if (ref.isHead) return ref.kind === "branch" ? "head" : "detached";
  return ref.kind;
}

function chipTitle(
  kind: RefChipKind,
  label: string,
  remotes: readonly string[],
): string {
  const description =
    kind === "head"
      ? `HEAD → ${label} (checked out)`
      : kind === "detached"
        ? "HEAD (detached)"
        : kind === "branch"
          ? `Branch ${label}`
          : kind === "remote"
            ? `Remote branch ${label}`
            : kind === "tag"
              ? `Tag ${label}`
              : kind === "stash"
                ? `Stash ${label}`
                : label;
  if (remotes.length === 0) return description;
  return `${description}\nAlso on ${remotes
    .map((remote) => `${remote}/${label}`)
    .join(", ")}`;
}

export function buildRefChips(refs: readonly GitRef[]): RefChip[] {
  const localBranches = new Set(
    refs.filter((ref) => ref.kind === "branch").map((ref) => ref.name),
  );
  const remotesByBranch = new Map<string, string[]>();
  const attachedRemoteRefs = new Set<string>();
  for (const ref of refs) {
    if (ref.kind !== "remote") continue;
    const slash = ref.name.indexOf("/");
    if (slash <= 0) continue;
    const branch = ref.name.slice(slash + 1);
    if (!localBranches.has(branch)) continue;
    remotesByBranch.set(branch, [
      ...(remotesByBranch.get(branch) ?? []),
      ref.name.slice(0, slash),
    ]);
    attachedRemoteRefs.add(ref.name);
  }
  return refs
    .filter(
      (ref) => !(ref.kind === "remote" && attachedRemoteRefs.has(ref.name)),
    )
    .map((ref) => {
      const kind = chipKind(ref);
      const remotes =
        ref.kind === "branch" ? (remotesByBranch.get(ref.name) ?? []) : [];
      return {
        key: `${ref.kind}:${ref.name}`,
        kind,
        label: ref.name,
        remotes,
        title: chipTitle(kind, ref.name, remotes),
      };
    });
}

function RefGlyph({ kind }: { kind: RefChipKind }) {
  if (kind === "head" || kind === "branch") {
    return (
      <svg
        viewBox="0 0 12 12"
        className="size-2.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M3.5 2.25v7.5M8.5 3.25c0 2.75-2.5 3.35-5 4.35" />
        <circle cx={3.5} cy={2.25} r={1.35} fill="currentColor" stroke="none" />
        <circle cx={3.5} cy={9.75} r={1.35} fill="currentColor" stroke="none" />
        <circle cx={8.5} cy={3.25} r={1.35} fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === "remote") {
    return (
      <svg
        viewBox="0 0 12 12"
        className="size-2.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3.6 9.6h5.1a2.3 2.3 0 0 0 .25-4.58A3.3 3.3 0 0 0 2.7 5.9 1.9 1.9 0 0 0 3.6 9.6Z" />
      </svg>
    );
  }
  if (kind === "tag") {
    return (
      <svg
        viewBox="0 0 12 12"
        className="size-2.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M1.75 1.75h4.4l4.1 4.1-4.4 4.4-4.1-4.1Z" />
        <circle cx={4.25} cy={4.25} r={0.9} fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === "stash") {
    return (
      <svg
        viewBox="0 0 12 12"
        className="size-2.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M1.75 2.25h8.5v2.5h-8.5ZM2.5 4.75v5h7v-5M5 6.75h2" />
      </svg>
    );
  }
  return null;
}

function RefChipView({
  chip,
  showRemotes,
}: {
  chip: RefChip;
  showRemotes: boolean;
}) {
  const filled = chip.kind === "head" || chip.kind === "detached";
  return (
    <span
      data-ref-kind={chip.kind}
      title={chip.title}
      className={`${CHIP_BASE_CLASS} ${KIND_TONE_CLASS[chip.kind]} ${
        filled ? FILLED_CHIP_CLASS : OUTLINE_CHIP_CLASS
      }`}
    >
      <RefGlyph kind={chip.kind} />
      <span className="min-w-0 truncate">{chip.label}</span>
      {showRemotes && chip.remotes.length > 0 ? (
        <span
          data-testid="git-graph-ref-remotes"
          className="min-w-0 shrink-[4] truncate border-l border-current/35 pl-1 font-normal opacity-80"
        >
          {chip.remotes.join(" ")}
        </span>
      ) : null}
    </span>
  );
}

export function RefPills({
  refs,
  maxVisible,
}: {
  refs: readonly GitRef[];
  maxVisible: number | null;
}) {
  const chips = buildRefChips(refs);
  if (chips.length === 0) return null;
  const visibleCount =
    maxVisible === null || chips.length <= maxVisible
      ? chips.length
      : Math.max(1, maxVisible - 1);
  const hidden = chips.slice(visibleCount);
  return (
    <span
      data-testid="git-graph-refs"
      className={
        maxVisible === null
          ? "flex min-w-0 flex-wrap items-center gap-1"
          : "flex min-w-0 max-w-[60%] shrink items-center gap-1 overflow-hidden"
      }
    >
      {chips.slice(0, visibleCount).map((chip) => (
        <RefChipView
          key={chip.key}
          chip={chip}
          showRemotes={maxVisible === null || maxVisible > 1}
        />
      ))}
      {hidden.length > 0 ? (
        <span
          data-ref-kind="overflow"
          title={hidden.map((chip) => chip.title).join("\n")}
          className={`${CHIP_BASE_CLASS} ${OVERFLOW_CHIP_CLASS}`}
        >
          +{hidden.length}
        </span>
      ) : null}
    </span>
  );
}

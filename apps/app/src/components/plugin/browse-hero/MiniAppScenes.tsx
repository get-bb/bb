import { cn } from "@bb/shared-ui/lib/utils";
import type { ShowcaseScenes } from "@/components/showcase-hero/showcase-archetype";
import {
  Bar,
  SceneCard,
  SceneLabel,
} from "@/components/showcase-hero/scene-primitives";
import {
  accentInk,
  accentTint,
  neutral,
} from "@/components/showcase-hero/showcase-tokens";

/**
 * The interchangeable interiors of the mini bb window. Each scene is a real
 * component built from theme tokens — not a screenshot — so it retints with the
 * palette, stays crisp at any DPI, and can never drift from the design system.
 *
 * Scenes are deliberately abstract: enough structure to read as "a board" or "a
 * dashboard" at a glance, with only the few words that carry meaning. They are
 * illustrations of what a plugin can render, not claims about a shipped plugin.
 */

export interface SceneProps {
  accentToken: string;
}

/** Board of threads, moved between columns by agents. */
export function KanbanScene({ accentToken }: SceneProps) {
  const columns = [
    { label: "Todo", cards: 3 },
    { label: "In progress", cards: 2, active: true },
    { label: "Review", cards: 2 },
  ];
  return (
    <div className="grid h-full grid-cols-3 gap-1.5 p-2">
      {columns.map((column) => (
        <div key={column.label} className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <SceneLabel>{column.label}</SceneLabel>
            <span
              className="text-2xs tabular-nums"
              style={{ color: neutral(38) }}
            >
              {column.cards}
            </span>
          </div>
          {Array.from({ length: column.cards }, (_, index) => {
            const highlighted = column.active === true && index === 0;
            return (
              <SceneCard
                key={index}
                className="flex flex-col gap-1"
                style={
                  highlighted
                    ? {
                        background: accentTint(accentToken, 10),
                        borderColor: accentTint(accentToken, 38),
                      }
                    : undefined
                }
              >
                <Bar width={index % 2 === 0 ? "82%" : "64%"} strength={16} />
                <div className="flex items-center gap-1">
                  <div
                    className="size-1.5 rounded-full"
                    style={{
                      background: highlighted
                        ? `var(${accentToken})`
                        : neutral(18),
                    }}
                  />
                  <Bar width="38%" strength={9} />
                </div>
              </SceneCard>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Homepage metrics: stat tiles over a bar chart. */
export function DashboardScene({ accentToken }: SceneProps) {
  const bars = [42, 61, 38, 78, 55, 88, 70];
  const stats = [
    { label: "Deploys", value: "18" },
    { label: "Open PRs", value: "7" },
    { label: "CI pass", value: "96%" },
  ];
  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="grid grid-cols-3 gap-1.5">
        {stats.map((stat, index) => (
          <SceneCard
            key={stat.label}
            className="flex flex-col gap-0.5"
            style={
              index === 2
                ? {
                    background: accentTint(accentToken, 10),
                    borderColor: accentTint(accentToken, 38),
                  }
                : undefined
            }
          >
            <SceneLabel>{stat.label}</SceneLabel>
            <span
              className="text-xs font-semibold tabular-nums"
              style={{
                color: index === 2 ? accentInk(accentToken, 55) : neutral(72),
              }}
            >
              {stat.value}
            </span>
          </SceneCard>
        ))}
      </div>
      <SceneCard className="flex min-h-0 flex-1 flex-col gap-1.5">
        <SceneLabel>Throughput</SceneLabel>
        <div className="flex min-h-0 flex-1 items-end gap-1">
          {bars.map((height, index) => (
            <div
              key={index}
              className="flex-1 rounded-sm"
              style={{
                height: `${height}%`,
                background:
                  index === bars.length - 2
                    ? `var(${accentToken})`
                    : accentTint(accentToken, 26),
              }}
            />
          ))}
        </div>
      </SceneCard>
    </div>
  );
}

/**
 * A brand studio: raw clips on a multitrack timeline mid-edit — video, audio,
 * and caption lanes under a playhead, with the render line narrating the
 * agents' pass. The timeline IS the surface: a rich creative suite agents
 * assemble and iterate, not a list with a media icon.
 */
export function BrandStudioScene({ accentToken }: SceneProps) {
  // One lane per media track; the active clip sits under the playhead.
  const videoClips = [
    { width: "24%", active: false },
    { width: "34%", active: true },
    { width: "18%", active: false },
    { width: "12%", active: false },
  ];
  const audioClips = [{ width: "42%" }, { width: "30%" }, { width: "16%" }];
  const captionTicks = ["10%", "8%", "12%", "7%", "9%"];
  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      <div className="flex items-center gap-1">
        <SceneLabel>Draft cut</SceneLabel>
        <span
          className="ml-auto rounded-full px-1.5 py-0.5 font-mono text-2xs font-medium tabular-nums"
          style={{
            background: accentTint(accentToken, 16),
            color: accentInk(accentToken, 62),
          }}
        >
          v2 · 00:42
        </span>
      </div>

      <SceneCard className="relative flex min-h-0 flex-1 flex-col justify-center gap-1.5">
        {/* The playhead spans every lane; the active clip sits under it. */}
        <div
          className="pointer-events-none absolute inset-y-1 left-[46%] w-px"
          style={{ background: `var(${accentToken})` }}
          aria-hidden
        />
        <div className="grid grid-cols-[0.875rem_minmax(0,1fr)] items-center gap-x-1 gap-y-1.5">
          <span className="font-mono text-2xs" style={{ color: neutral(40) }}>
            V
          </span>
          <div className="flex h-3.5 items-stretch gap-0.5">
            {videoClips.map((clip, index) => (
              <span
                key={index}
                className="rounded-sm"
                style={{
                  width: clip.width,
                  background: clip.active
                    ? accentTint(accentToken, 34)
                    : neutral(12),
                }}
              />
            ))}
          </div>
          <span className="font-mono text-2xs" style={{ color: neutral(40) }}>
            A
          </span>
          <div className="flex h-2 items-stretch gap-0.5">
            {audioClips.map((clip, index) => (
              <span
                key={index}
                className="rounded-sm"
                style={{
                  width: clip.width,
                  background: accentTint("--success", 30),
                }}
              />
            ))}
          </div>
          <span className="font-mono text-2xs" style={{ color: neutral(40) }}>
            C
          </span>
          <div className="flex h-1.5 items-stretch gap-1">
            {captionTicks.map((width, index) => (
              <span
                key={index}
                className="rounded-sm"
                style={{ width, background: neutral(16) }}
              />
            ))}
          </div>
        </div>
      </SceneCard>

      <div
        className="flex items-center gap-1.5 rounded-md border border-dashed px-1.5 py-1"
        style={{ borderColor: accentTint(accentToken, 40) }}
      >
        <span className="font-mono text-2xs" style={{ color: neutral(46) }}>
          captions added
        </span>
        <span
          className="text-2xs font-medium"
          style={{ color: accentInk(accentToken, 62) }}
        >
          → rendering cut v2
        </span>
      </div>
    </div>
  );
}

/**
 * A replaced thread list: the work you handed off, grouped by workstream with
 * live progress, and the one item waiting on you pulled to the surface — the
 * chief-of-staff job, not another list.
 */
export function ChiefOfStaffScene({ accentToken }: SceneProps) {
  const lanes = [
    { worktree: "feat/billing", agents: 4, progress: 72, blocked: false },
    { worktree: "fix/auth", agents: 3, progress: 45, blocked: true },
    { worktree: "chore/deps", agents: 5, progress: 88, blocked: false },
  ];
  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      <div className="flex items-center justify-between">
        <SceneLabel>Working for you</SceneLabel>
        <span
          className="rounded-full px-1.5 py-0.5 text-2xs font-medium tabular-nums"
          style={{
            background: accentTint(accentToken, 14),
            color: accentInk(accentToken, 60),
          }}
        >
          12 running
        </span>
      </div>
      {lanes.map((lane) => (
        <SceneCard key={lane.worktree} className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="font-mono text-2xs" style={{ color: neutral(52) }}>
              {lane.worktree}
            </span>
            {lane.blocked ? (
              <span
                className="ml-auto rounded-sm px-1 text-2xs font-medium"
                style={{
                  background: accentTint("--warning", 18),
                  color: accentInk("--warning", 62),
                }}
              >
                needs you
              </span>
            ) : (
              <span
                className="ml-auto text-2xs tabular-nums"
                style={{ color: neutral(38) }}
              >
                {lane.agents} agents
              </span>
            )}
          </div>
          {/* Per-agent progress: the parallelism is the point, so each agent
              gets its own track rather than one aggregate bar. */}
          <div className="flex items-center gap-0.5">
            {Array.from({ length: lane.agents }, (_, index) => (
              <div
                key={index}
                className="h-1.5 flex-1 overflow-hidden rounded-full"
                style={{ background: neutral(8) }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(18, (lane.progress + index * 9) % 100)}%`,
                    background:
                      index === 0
                        ? `var(${accentToken})`
                        : accentTint(accentToken, 34),
                  }}
                />
              </div>
            ))}
          </div>
        </SceneCard>
      ))}
    </div>
  );
}

/**
 * A design studio: one brief, N takes building in parallel SPLIT VIEWS —
 * the same split panes bb uses for side-by-side threads — with the count
 * under the user's control (up to ten). The splits ARE the point: watching
 * competing takes assemble simultaneously only exists because the user chose
 * a number and agents fanned out.
 */
export function DesignStudioScene({ accentToken }: SceneProps) {
  // The chosen count drives everything: the stepper, the split panes, and
  // the console line all reflect the same number.
  const chosenCount = 4;
  const splits = [
    { name: "take 1", state: "building" },
    { name: "take 2", state: "ready" },
    { name: "take 3", state: "building" },
    { name: "take 4", state: "building" },
  ];
  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      <div className="flex items-center gap-1.5">
        <SceneLabel>Checkout flow</SceneLabel>
        {/* The prototype-count control: pick how many takes, capped at ten. */}
        <span className="ml-auto flex items-center gap-1">
          <span className="text-2xs" style={{ color: neutral(40) }}>
            Variants
          </span>
          <span
            className="flex items-center overflow-hidden rounded-md border"
            style={{ borderColor: neutral(14) }}
          >
            <span
              className="px-1.5 text-2xs"
              style={{ color: neutral(40), background: neutral(4) }}
            >
              −
            </span>
            <span
              className="px-1.5 text-2xs font-semibold tabular-nums"
              style={{ color: accentInk(accentToken, 62) }}
            >
              {chosenCount}
            </span>
            <span
              className="px-1.5 text-2xs"
              style={{ color: neutral(40), background: neutral(4) }}
            >
              +
            </span>
          </span>
          <span className="text-2xs" style={{ color: neutral(34) }}>
            of 10
          </span>
        </span>
      </div>

      {/* One split pane per chosen take, each a live agent thread: title bar
          with a working dot, a sketched screen, and its own progress track. */}
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1">
        {splits.map((split, index) => {
          const ready = split.state === "ready";
          return (
            <SceneCard
              key={split.name}
              className="flex min-h-0 flex-col gap-1 p-1.5"
              style={
                ready
                  ? {
                      background: accentTint(accentToken, 10),
                      borderColor: accentTint(accentToken, 38),
                    }
                  : undefined
              }
            >
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    !ready && "animate-pulse motion-reduce:animate-none",
                  )}
                  style={{
                    background: ready ? `var(${accentToken})` : neutral(24),
                  }}
                />
                <span
                  className="font-mono text-2xs"
                  style={{
                    color: ready ? accentInk(accentToken, 62) : neutral(48),
                  }}
                >
                  {split.name}
                </span>
                {ready ? (
                  <span
                    className="ml-auto rounded-sm px-1 text-2xs font-medium"
                    style={{
                      background: accentTint(accentToken, 18),
                      color: accentInk(accentToken, 62),
                    }}
                  >
                    ready
                  </span>
                ) : null}
              </div>
              <Bar width={index % 2 === 0 ? "78%" : "62%"} strength={12} />
              <div
                className="mt-auto h-1 overflow-hidden rounded-full"
                style={{ background: neutral(8) }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: ready ? "100%" : `${34 + index * 17}%`,
                    background: ready
                      ? `var(${accentToken})`
                      : accentTint(accentToken, 34),
                  }}
                />
              </div>
            </SceneCard>
          );
        })}
      </div>

      <div
        className="flex items-center gap-1.5 rounded-md border border-dashed px-1.5 py-1"
        style={{ borderColor: accentTint(accentToken, 40) }}
      >
        <span className="font-mono text-2xs" style={{ color: neutral(46) }}>
          {chosenCount} agents in splits
        </span>
        <span
          className="text-2xs font-medium"
          style={{ color: accentInk(accentToken, 62) }}
        >
          → take 2 ready to compare
        </span>
      </div>
    </div>
  );
}

/**
 * A triage inbox: incoming reports with kind chips, one clustered duplicate
 * count, and the handoff into a fix thread — intake becoming work.
 */
export function InboxScene({ accentToken }: SceneProps) {
  const rows = [
    { width: "76%", kind: "bug", cluster: "×4", active: true },
    { width: "58%", kind: "question", cluster: null, active: false },
    { width: "68%", kind: "bug", cluster: "×2", active: false },
  ];
  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      <div className="flex items-center gap-1">
        <SceneLabel>Inbox</SceneLabel>
        <span
          className="ml-auto rounded-full px-1.5 py-0.5 text-2xs font-medium tabular-nums"
          style={{
            background: accentTint(accentToken, 14),
            color: accentInk(accentToken, 62),
          }}
        >
          9 open
        </span>
      </div>
      {rows.map((row, index) => (
        <SceneCard
          key={index}
          className="flex items-center gap-1.5"
          style={
            row.active
              ? {
                  background: accentTint(accentToken, 10),
                  borderColor: accentTint(accentToken, 38),
                }
              : undefined
          }
        >
          <span
            className="rounded-sm px-1 py-0.5 text-2xs font-medium"
            style={
              row.kind === "bug"
                ? {
                    background: accentTint(accentToken, 18),
                    color: accentInk(accentToken, 62),
                  }
                : { background: neutral(7), color: neutral(48) }
            }
          >
            {row.kind}
          </span>
          <Bar width={row.width} strength={row.active ? 22 : 14} />
          {row.cluster !== null ? (
            <span
              className="ml-auto shrink-0 text-2xs tabular-nums"
              style={{ color: neutral(40) }}
            >
              {row.cluster}
            </span>
          ) : null}
        </SceneCard>
      ))}
      <div
        className="mt-auto flex items-center gap-1.5 rounded-md border border-dashed px-1.5 py-1"
        style={{ borderColor: accentTint(accentToken, 40) }}
      >
        <span className="font-mono text-2xs" style={{ color: neutral(46) }}>
          reply drafted
        </span>
        <span
          className="text-2xs font-medium"
          style={{ color: accentInk(accentToken, 62) }}
        >
          → fix thread opened
        </span>
      </div>
    </div>
  );
}

/** Scene renderers keyed by archetype id. */
export const MINI_APP_SCENES: ShowcaseScenes = {
  "kanban-board": KanbanScene,
  "live-dashboard": DashboardScene,
  "chief-of-staff": ChiefOfStaffScene,
  "brand-studio": BrandStudioScene,
  "design-studio": DesignStudioScene,
  "support-inbox": InboxScene,
};

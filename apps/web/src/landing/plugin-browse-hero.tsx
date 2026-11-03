import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon";
import ChartColumnIcon from "@hugeicons/core-free-icons/ChartColumnIcon";
import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import Layout2ColumnIcon from "@hugeicons/core-free-icons/Layout2ColumnIcon";
import Mail02Icon from "@hugeicons/core-free-icons/Mail02Icon";
import PlayIcon from "@hugeicons/core-free-icons/PlayIcon";
import TestTube01Icon from "@hugeicons/core-free-icons/TestTube01Icon";
import UserIcon from "@hugeicons/core-free-icons/UserIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { CSSProperties, ReactElement, ReactNode } from "react";

export const PLUGINS_BROWSE_DESCRIPTION =
  "Discover plugins for bb. Install one, or describe your own and build it from a prompt.";

type Archetype = {
  id: string;
  noun: string;
  title: string;
  icon: IconSvgElement;
  accent: string;
};

export const BROWSE_ARCHETYPES: readonly Archetype[] = [
  {
    id: "kanban-board",
    noun: "a kanban board",
    title: "Kanban board",
    icon: Layout2ColumnIcon,
    accent: "--hero-file-accent",
  },
  {
    id: "live-dashboard",
    noun: "a live dashboard",
    title: "Live dashboard",
    icon: ChartColumnIcon,
    accent: "--hero-success",
  },
  {
    id: "chief-of-staff",
    noun: "a chief of staff",
    title: "Chief of staff",
    icon: UserIcon,
    accent: "--hero-pr-merged",
  },
  {
    id: "video-editor",
    noun: "a video editor",
    title: "Video editor",
    icon: PlayIcon,
    accent: "--hero-warning",
  },
  {
    id: "prototyping-lab",
    noun: "a prototyping lab",
    title: "Prototyping lab",
    icon: TestTube01Icon,
    accent: "--hero-attention",
  },
  {
    id: "support-inbox",
    noun: "a support inbox",
    title: "Support inbox",
    icon: Mail02Icon,
    accent: "--hero-destructive-text",
  },
];

export const HERO_SLIDE_MS = 5000;

const PLUGIN_RAIL: readonly IconSvgElement[] = [
  BubbleChatIcon,
  Folder01Icon,
  CheckListIcon,
];

const ORBIT_POSITIONS: readonly CSSProperties[] = [
  { top: "2%", left: 0 },
  { top: "38%", left: 0 },
  { top: "72%", left: 0 },
  { top: "14%", right: 0 },
  { top: "48%", right: 0 },
  { top: "82%", right: 0 },
];

function tint(token: string, percent: number) {
  return `color-mix(in oklab, var(${token}) ${percent}%, var(--bg))`;
}

function ink(token: string, percent: number) {
  return `color-mix(in oklab, var(${token}) ${percent}%, var(--ink))`;
}

function neutral(percent: number) {
  return `color-mix(in oklch, var(--ink) ${percent}%, var(--bg))`;
}

function Bar({ width, strength = 12 }: { width: string; strength?: number }) {
  return (
    <div className="bh-bar" style={{ width, background: neutral(strength) }} />
  );
}

function Card({
  children,
  className,
  style,
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className ? `bh-card ${className}` : "bh-card"}
      style={{ borderColor: neutral(11), ...style }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="bh-label" style={{ color: neutral(52) }}>
      {children}
    </span>
  );
}

function Pill({
  accent,
  children,
  mono = false,
}: {
  accent: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <span
      className={mono ? "bh-pill bh-mono" : "bh-pill"}
      style={{ background: tint(accent, 14), color: ink(accent, 62) }}
    >
      {children}
    </span>
  );
}

function Handoff({
  accent,
  from,
  to,
  mono = false,
  push = false,
}: {
  accent: string;
  from: string;
  to: string;
  mono?: boolean;
  push?: boolean;
}) {
  return (
    <div
      className={push ? "bh-handoff bh-push" : "bh-handoff"}
      style={{ borderColor: tint(accent, 40) }}
    >
      <span
        className={mono ? "bh-mono" : undefined}
        style={{ color: neutral(46) }}
      >
        {from}
      </span>
      <span className="bh-strong" style={{ color: ink(accent, 62) }}>
        → {to}
      </span>
    </div>
  );
}

const highlighted = (accent: string): CSSProperties => ({
  background: tint(accent, 10),
  borderColor: tint(accent, 38),
});

function KanbanScene({ accent }: { accent: string }) {
  const columns = [
    { label: "Todo", cards: 3, active: false },
    { label: "In progress", cards: 2, active: true },
    { label: "Review", cards: 2, active: false },
  ];
  return (
    <div className="bh-scene bh-cols3">
      {columns.map((column) => (
        <div key={column.label} className="bh-col">
          <div className="bh-row">
            <Label>{column.label}</Label>
            <span className="bh-num" style={{ color: neutral(38) }}>
              {column.cards}
            </span>
          </div>
          {Array.from({ length: column.cards }, (_, index) => {
            const on = column.active && index === 0;
            return (
              <Card
                key={index}
                className="bh-stack"
                style={on ? highlighted(accent) : undefined}
              >
                <Bar width={index % 2 === 0 ? "82%" : "64%"} strength={16} />
                <div className="bh-row">
                  <div
                    className="bh-dot"
                    style={{ background: on ? `var(${accent})` : neutral(18) }}
                  />
                  <Bar width="38%" strength={9} />
                </div>
              </Card>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DashboardScene({ accent }: { accent: string }) {
  const bars = [42, 61, 38, 78, 55, 88, 70];
  const stats = [
    { label: "Deploys", value: "18" },
    { label: "Open PRs", value: "7" },
    { label: "CI pass", value: "96%" },
  ];
  return (
    <div className="bh-scene bh-column bh-gap8">
      <div className="bh-cols3 bh-gap6">
        {stats.map((stat, index) => (
          <Card
            key={stat.label}
            className="bh-stack bh-gap2"
            style={index === 2 ? highlighted(accent) : undefined}
          >
            <Label>{stat.label}</Label>
            <span
              className="bh-stat"
              style={{ color: index === 2 ? ink(accent, 55) : neutral(72) }}
            >
              {stat.value}
            </span>
          </Card>
        ))}
      </div>
      <Card className="bh-stack bh-fill">
        <Label>Throughput</Label>
        <div className="bh-chart">
          {bars.map((height, index) => (
            <div
              key={index}
              className="bh-chart-bar"
              style={{
                height: `${height}%`,
                background:
                  index === bars.length - 2
                    ? `var(${accent})`
                    : tint(accent, 26),
              }}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function ChiefOfStaffScene({ accent }: { accent: string }) {
  const lanes = [
    { worktree: "feat/billing", agents: 4, progress: 72, blocked: false },
    { worktree: "fix/auth", agents: 3, progress: 45, blocked: true },
    { worktree: "chore/deps", agents: 5, progress: 88, blocked: false },
  ];
  return (
    <div className="bh-scene bh-column">
      <div className="bh-row bh-between">
        <Label>Working for you</Label>
        <Pill accent={accent}>12 running</Pill>
      </div>
      {lanes.map((lane) => (
        <Card key={lane.worktree} className="bh-stack">
          <div className="bh-row">
            <span className="bh-mono" style={{ color: neutral(52) }}>
              {lane.worktree}
            </span>
            {lane.blocked ? (
              <span
                className="bh-tag bh-end"
                style={{
                  background: tint("--hero-warning", 18),
                  color: ink("--hero-warning", 62),
                }}
              >
                needs you
              </span>
            ) : (
              <span className="bh-num bh-end" style={{ color: neutral(38) }}>
                {lane.agents} agents
              </span>
            )}
          </div>
          <div className="bh-row bh-gap2">
            {Array.from({ length: lane.agents }, (_, index) => (
              <div
                key={index}
                className="bh-track"
                style={{ background: neutral(8) }}
              >
                <div
                  className="bh-track-fill"
                  style={{
                    width: `${Math.max(18, (lane.progress + index * 9) % 100)}%`,
                    background:
                      index === 0 ? `var(${accent})` : tint(accent, 34),
                  }}
                />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function VideoEditorScene({ accent }: { accent: string }) {
  const tracks = [
    { label: "Video", height: 14, clips: ["24%", "34%", "18%"], active: 1 },
    { label: "Audio", height: 8, clips: ["42%", "30%", "16%"], active: -1 },
    {
      label: "Captions",
      height: 6,
      clips: ["16%", "13%", "19%", "12%"],
      active: -1,
    },
  ];
  return (
    <div className="bh-scene bh-column">
      <div className="bh-row">
        <Label>Launch video</Label>
        <span className="bh-end">
          <Pill accent={accent} mono>
            first cut · 00:42
          </Pill>
        </span>
      </div>
      <Card className="bh-timeline bh-fill">
        <div className="bh-playhead" style={{ background: `var(${accent})` }} />
        {tracks.map((track) => (
          <div key={track.label} className="bh-lane">
            <span className="bh-strong" style={{ color: neutral(46) }}>
              {track.label}
            </span>
            <div className="bh-clips" style={{ height: track.height }}>
              {track.clips.map((width, index) => (
                <span
                  key={index}
                  className="bh-clip"
                  style={{
                    width,
                    background:
                      track.label === "Audio"
                        ? tint("--hero-success", 30)
                        : index === track.active
                          ? tint(accent, 36)
                          : neutral(track.label === "Captions" ? 16 : 12),
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </Card>
      <Handoff
        accent={accent}
        from="captions and music added"
        to="rendering first cut"
      />
    </div>
  );
}

function PrototypingLabScene({ accent }: { accent: string }) {
  const prototypes = [
    { name: "Guided", ready: true },
    { name: "One page", ready: true },
    { name: "Express", ready: false },
  ];
  return (
    <div className="bh-scene bh-column">
      <div className="bh-row bh-gap6">
        <Label>Checkout flow</Label>
        <span className="bh-end">
          <Pill accent={accent}>3 prototypes</Pill>
        </span>
      </div>
      <div className="bh-cols3 bh-gap4 bh-fill">
        {prototypes.map((prototype, index) => (
          <Card
            key={prototype.name}
            className="bh-stack bh-proto"
            style={prototype.ready ? highlighted(accent) : undefined}
          >
            <div className="bh-row">
              <span
                className="bh-dot"
                style={{
                  background: prototype.ready ? `var(${accent})` : neutral(24),
                }}
              />
              <span
                className="bh-strong"
                style={{
                  color: prototype.ready ? ink(accent, 62) : neutral(48),
                }}
              >
                {prototype.name}
              </span>
            </div>
            <Label>{prototype.ready ? "ready" : "building"}</Label>
            <Bar width={index % 2 === 0 ? "78%" : "62%"} strength={14} />
            <Bar width={index % 2 === 0 ? "58%" : "74%"} strength={10} />
            <Card className="bh-stack bh-preview">
              <Bar width="72%" strength={12} />
              <Bar width="48%" strength={8} />
            </Card>
            <div className="bh-progress" style={{ background: neutral(8) }}>
              <div
                className="bh-track-fill"
                style={{
                  width: prototype.ready ? "100%" : "58%",
                  background: prototype.ready
                    ? `var(${accent})`
                    : tint(accent, 34),
                }}
              />
            </div>
          </Card>
        ))}
      </div>
      <Handoff
        accent={accent}
        from="2 prototypes ready"
        to="compare side by side"
      />
    </div>
  );
}

function InboxScene({ accent }: { accent: string }) {
  const rows = [
    { width: "76%", kind: "bug", cluster: "×4", active: true },
    { width: "58%", kind: "question", cluster: null, active: false },
    { width: "68%", kind: "bug", cluster: "×2", active: false },
  ];
  return (
    <div className="bh-scene bh-column">
      <div className="bh-row">
        <Label>Inbox</Label>
        <span className="bh-end">
          <Pill accent={accent}>9 open</Pill>
        </span>
      </div>
      {rows.map((row, index) => (
        <Card
          key={index}
          className="bh-row bh-gap6"
          style={row.active ? highlighted(accent) : undefined}
        >
          <span
            className="bh-tag bh-tag-pad"
            style={
              row.kind === "bug"
                ? { background: tint(accent, 18), color: ink(accent, 62) }
                : { background: neutral(7), color: neutral(48) }
            }
          >
            {row.kind}
          </span>
          <Bar width={row.width} strength={row.active ? 22 : 14} />
          {row.cluster !== null ? (
            <span className="bh-num bh-end" style={{ color: neutral(40) }}>
              {row.cluster}
            </span>
          ) : null}
        </Card>
      ))}
      <Handoff
        accent={accent}
        from="reply drafted"
        to="fix thread opened"
        mono
        push
      />
    </div>
  );
}

const SCENES: Record<string, (props: { accent: string }) => ReactElement> = {
  "kanban-board": KanbanScene,
  "live-dashboard": DashboardScene,
  "chief-of-staff": ChiefOfStaffScene,
  "video-editor": VideoEditorScene,
  "prototyping-lab": PrototypingLabScene,
  "support-inbox": InboxScene,
};

function Glyph({
  icon,
  className,
}: {
  icon: IconSvgElement;
  className: string;
}) {
  return <HugeiconsIcon icon={icon} className={className} />;
}

function HeroFrame({ active, previous }: { active: number; previous: number }) {
  const archetype = BROWSE_ARCHETYPES[active]!;
  const accent = archetype.accent;
  return (
    <div className="bh-frame" style={{ borderColor: neutral(16) }}>
      <div
        className="bh-frame-bar"
        style={{ borderColor: neutral(10), background: neutral(3) }}
      >
        <span className="bh-lights">
          {["--hero-destructive", "--hero-attention", "--hero-success"].map(
            (token) => (
              <i key={token} style={{ background: tint(token, 78) }} />
            ),
          )}
        </span>
        <span className="bh-frame-title" style={{ color: neutral(48) }}>
          bb — {archetype.title}
        </span>
        <span
          className="bh-pill"
          style={{ background: tint(accent, 14), color: ink(accent, 60) }}
        >
          Plugin
        </span>
      </div>
      <div className="bh-frame-body">
        <div
          className="bh-frame-rail"
          style={{ borderColor: neutral(10), background: neutral(2) }}
        >
          {PLUGIN_RAIL.map((icon, index) => (
            <span
              key={index}
              className="bh-rail-btn"
              style={{ color: neutral(30) }}
            >
              <Glyph icon={icon} className="bh-ic" />
            </span>
          ))}
          <span className="bh-rail-rule" style={{ background: neutral(12) }} />
          <span
            className="bh-rail-btn bh-rail-plugin"
            style={{
              background: tint(accent, 16),
              borderColor: tint(accent, 42),
              color: ink(accent, 62),
            }}
          >
            <Glyph icon={archetype.icon} className="bh-ic" />
          </span>
        </div>
        <div className="bh-stage">
          {BROWSE_ARCHETYPES.map((item, index) => {
            const Scene = SCENES[item.id]!;
            const state =
              index === active
                ? previous < 0
                  ? "is-on"
                  : "is-on is-new"
                : index === previous
                  ? "is-under"
                  : "is-off";
            return (
              <div
                key={item.id}
                className={`bh-layer ${state}`}
                data-scene={item.id}
              >
                <Scene accent={item.accent} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function BrowseHero({
  active,
  previous,
}: {
  active: number;
  previous: number;
}) {
  const archetype = BROWSE_ARCHETYPES[active]!;
  return (
    <section className="bh">
      <div className="bh-headline">
        Turn bb into{" "}
        <span
          key={archetype.id}
          className={previous < 0 ? "bh-noun" : "bh-noun is-new"}
          style={{ color: ink(archetype.accent, 72) }}
        >
          {archetype.noun}
        </span>
      </div>
      <p className="bh-lede">{PLUGINS_BROWSE_DESCRIPTION}</p>
      <div className="bh-orbit">
        {BROWSE_ARCHETYPES.map((item, index) => {
          const on = index === active;
          return (
            <span
              key={item.id}
              className={on ? "bh-chip is-on" : "bh-chip"}
              style={
                {
                  ...ORBIT_POSITIONS[index],
                  "--bh-drift-duration": `${6 + index * 0.7}s`,
                  "--bh-drift-delay": `${index * 0.45}s`,
                  background: on ? tint(item.accent, 12) : "var(--bg)",
                  borderColor: on ? tint(item.accent, 40) : neutral(13),
                  color: on ? ink(item.accent, 62) : neutral(46),
                } as CSSProperties
              }
            >
              <Glyph icon={item.icon} className="bh-ic" />
              <span className="bh-chip-label">{item.title}</span>
            </span>
          );
        })}
        <HeroFrame active={active} previous={previous} />
      </div>
      <div className="bh-tabs">
        {BROWSE_ARCHETYPES.map((item, index) => {
          const on = index === active;
          return (
            <span key={item.id} className="bh-tab">
              <span
                className={on ? "bh-tab-bar is-on" : "bh-tab-bar"}
                style={{ background: on ? tint(item.accent, 22) : neutral(14) }}
              >
                {on ? (
                  <span
                    key={`${item.id}-${active}`}
                    className="bh-tab-fill"
                    style={
                      {
                        "--bh-slide-ms": `${HERO_SLIDE_MS}ms`,
                        background: `var(${item.accent})`,
                      } as CSSProperties
                    }
                  />
                ) : null}
              </span>
            </span>
          );
        })}
      </div>
    </section>
  );
}

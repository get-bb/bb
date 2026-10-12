import type { ReactNode } from "react";
import { TIP_CATALOG, renderTip, type TipSignals } from "./catalog.js";
import {
  Arrow,
  Bar,
  Branch,
  Bubble,
  Button,
  CalendarGrid,
  CardStack,
  ChartAxes,
  Check,
  CheckMark,
  Clock,
  Cursor,
  Diagram,
  DiagramKitStyles,
  Dot,
  Envelope,
  HOVER_ANIMATIONS,
  Highlight,
  Keycap,
  ListLine,
  Magnifier,
  Node,
  Panel,
  Phone,
  Pill,
  ProgressBar,
  Rule,
  SearchGlyph,
  Slider,
  Sparkle,
  Toggle,
  Window,
  Wrench,
  type HoverAnimation,
} from "./diagram-kit.js";
import { TONE_COLOR, TipArt } from "./illustrations.js";

export default { title: "plugins/Tips" };

const ACCENT = TONE_COLOR.blue;

const STORY_SIGNALS: TipSignals = {
  client: { surface: "desktop", os: "macos" },
  projectId: null,
  serverPlatform: "darwin",
  appVersion: "0.46.0",
  firstSeenVersion: "0.45.0",
  daysSinceFirstSeen: 7,
  threadCount: 60,
  availableProviderCount: 3,
  installedPlugins: {},
  hasFinishedThread: true,
  finishedThreadCount: 10,
  hasChildThread: false,
  hasAutomationThread: false,
  projectHasChildThread: false,
  projectHasAutomationThread: false,
  waitingThreadCount: 3,
  rateLimited: false,
  recentlyRateLimited: false,
  queuedFollowUp: false,
  usedMobileApp: false,
};

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      tabIndex={0}
      data-tip-art-trigger=""
      className="flex flex-col items-start gap-1 rounded-lg p-2 outline-none hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function Sheet({ children }: { children: ReactNode }) {
  return (
    <div className="grid w-[820px] grid-cols-6 gap-3 rounded-xl border border-border bg-background p-5">
      <DiagramKitStyles />
      {children}
    </div>
  );
}

const PRIMITIVES: readonly (readonly [string, ReactNode])[] = [
  ["Panel", <Panel key="panel" x={8} y={8} width={32} height={32} />],
  ["Window", <Window key="window" x={4} y={8} width={40} height={32} />],
  ["Rule", <Rule key="rule" x={8} y={24} width={32} />],
  ["Dot", <Dot key="dot" cx={24} cy={24} r={3} color={ACCENT} />],
  ["ListLine", <ListLine key="list" x={10} y={24} width={24} />],
  [
    "Node + Branch",
    <g key="branch">
      <Node cx={10} cy={24} />
      <Branch start={[14.5, 24]} end={[38, 12]} />
      <Branch start={[14.5, 24]} end={[38, 36]} />
    </g>,
  ],
  [
    "ProgressBar",
    <ProgressBar key="progress" x={8} y={24} width={32} value={0.6} />,
  ],
  [
    "Toggle",
    <g key="toggle">
      <Toggle x={19} y={14} on />
      <Toggle x={19} y={28} on={false} />
    </g>,
  ],
  [
    "Slider",
    <Slider key="slider" x={8} y={24} width={32} knob={24} color={ACCENT} />,
  ],
  [
    "Button + CheckMark",
    <g key="button">
      <Button x={8} y={14} width={32} color={ACCENT} />
      <CheckMark x={21} y={19} color={ACCENT} />
      <Button x={8} y={28} width={32} />
    </g>,
  ],
  ["Check", <Check key="check" cx={24} cy={24} r={8} color={ACCENT} />],
  ["Cursor", <Cursor key="cursor" x={20} y={18} />],
  ["Phone", <Phone key="phone" x={14} y={4} />],
  ["Envelope", <Envelope key="envelope" x={6} y={16} width={36} height={20} />],
  [
    "Keycap",
    <Keycap key="keycap" x={14} y={18} width={20} height={12} label="⌘K" />,
  ],
  [
    "Magnifier",
    <g key="magnifier">
      <SearchGlyph cx={10} cy={10} />
      <Magnifier cx={22} cy={22} />
    </g>,
  ],
  [
    "ChartAxes + Bar",
    <g key="chart">
      <ChartAxes x={5} y={6} width={38} height={36} limit={13} />
      <Bar x={12} baseline={42} height={18} />
      <Bar x={22} baseline={42} height={26} color={ACCENT} />
      <Bar x={32} baseline={42} height={12} />
    </g>,
  ],
  ["CardStack", <CardStack key="stack" x={8} y={16} width={28} height={18} />],
  [
    "Arrow",
    <Arrow
      key="arrow"
      d="M10 14v14a4 4 0 0 0 4 4h20"
      head="M34 28.5l3.5 3.5-3.5 3.5"
      color={ACCENT}
    />,
  ],
  [
    "Sparkle",
    <Sparkle key="sparkle" cx={24} cy={24} size={9} color={ACCENT} />,
  ],
  [
    "Bubble",
    <Bubble
      key="bubble"
      x={4}
      y={8}
      width={40}
      height={20}
      tail={[16, 6, 5]}
    />,
  ],
  ["Clock", <Clock key="clock" cx={24} cy={24} r={12} color={ACCENT} />],
  [
    "CalendarGrid",
    <CalendarGrid key="calendar" x={9} y={10} width={30} height={30} />,
  ],
  ["Wrench", <Wrench key="wrench" x={12} y={12} color={ACCENT} />],
  ["Pill", <Pill key="pill" x={6} y={18} width={36} height={12} dashed />],
  [
    "Highlight",
    <Highlight
      key="highlight"
      x={6}
      y={18}
      width={36}
      height={12}
      color={ACCENT}
    />,
  ],
];

function animationDemo(animation: HoverAnimation): ReactNode {
  switch (animation) {
    case "fill-in":
      return (
        <ProgressBar x={8} y={24} width={32} value={0.4} animate="fill-in" />
      );
    case "flip-on":
      return <Toggle x={19} y={21} on={false} animate="flip-on" />;
    case "flip-off":
      return <Dot cx={24} cy={24} r={5} color={ACCENT} animate="flip-off" />;
    case "glide":
      return (
        <Slider
          x={8}
          y={24}
          width={32}
          knob={18}
          to={34}
          color={ACCENT}
          animate="glide"
        />
      );
    case "spin":
      return <Clock cx={24} cy={24} r={12} color={ACCENT} animate="spin" />;
    case "grow":
      return (
        <g>
          {[10, 20, 30].map((x, index) => (
            <Bar
              key={x}
              x={x}
              baseline={40}
              height={12 + index * 8}
              animate="grow"
              stagger={index === 0 ? 0 : index === 1 ? 1 : 2}
            />
          ))}
        </g>
      );
    default:
      return <Panel x={14} y={14} width={20} height={20} animate={animation} />;
  }
}

export function Illustrations() {
  return (
    <Sheet>
      {TIP_CATALOG.map((definition) => {
        const view = renderTip(definition, STORY_SIGNALS);
        return (
          <Cell key={view.id} label={view.title}>
            <TipArt illustration={view.illustration} tone={view.tone} />
          </Cell>
        );
      })}
    </Sheet>
  );
}

export function DiagramKit() {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">Primitives</h2>
        <Sheet>
          {PRIMITIVES.map(([label, part]) => (
            <Cell key={label} label={label}>
              <Diagram>{part}</Diagram>
            </Cell>
          ))}
        </Sheet>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">
          Hover animations (hover or focus a cell to play)
        </h2>
        <Sheet>
          {HOVER_ANIMATIONS.map((animation) => (
            <Cell key={animation} label={animation}>
              <Diagram>{animationDemo(animation)}</Diagram>
            </Cell>
          ))}
        </Sheet>
      </section>
    </div>
  );
}
DiagramKit.storyName = "Diagram kit";

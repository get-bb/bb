import type { ReactNode } from "react";
import type { TipTone } from "./contract.js";
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
  Highlight,
  Keycap,
  LINE,
  ListLine,
  Magnifier,
  Node,
  Panel,
  Part,
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
  type Stagger,
} from "./diagram-kit.js";

export const TONE_COLOR: Record<TipTone, string> = {
  blue: "var(--timeline-accent)",
  green: "var(--success)",
  amber: "var(--attention)",
  orange: "var(--warning)",
  rose: "color-mix(in oklab, var(--destructive) 55%, var(--timeline-accent))",
};

type Illustration = (accent: string) => ReactNode;

const PANES: readonly (readonly [number, number])[] = [
  [8, 16],
  [25, 16],
  [8, 29],
  [25, 29],
];

const USAGE_BARS: readonly (readonly [number, number])[] = [
  [10, 22],
  [18, 15],
  [26, 28],
  [34, 19],
];

function step(index: number): Stagger {
  return index <= 0
    ? 0
    : index === 1
      ? 1
      : index === 2
        ? 2
        : index === 3
          ? 3
          : 4;
}

export const ILLUSTRATIONS: Record<string, Illustration> = {
  "whats-new": (accent) => (
    <>
      <Panel x={6} y={9} width={28} height={33} />
      <Rule x={11} y={16} width={10} />
      <path {...LINE} d="M11 23.5h2.5M12.25 22.25v2.5" />
      <Rule x={16.5} y={23.5} width={12} soft />
      <path {...LINE} d="M11 30.5h2.5M12.25 29.25v2.5" />
      <Rule x={16.5} y={30.5} width={9} soft />
      <Rule x={11} y={36.5} width={14} soft />
      <Sparkle cx={39} cy={11} color={accent} animate="twinkle" />
    </>
  ),
  "account-pool": (accent) => (
    <>
      <CardStack x={6} y={11} width={28} height={16}>
        <circle {...LINE} cx={13} cy={19} r={3} />
        <Rule x={19} y={17} width={10} />
        <Rule x={19} y={21.5} width={7} soft />
      </CardStack>
      <Arrow
        d="M20 27v5.5a4 4 0 0 0 4 4h6"
        head="M30 33.5l3.5 3-3.5 3"
        color={accent}
        animate="nudge"
      />
      <Panel x={34.5} y={32} width={9} height={9} rx={2} />
      <Part animate="flip-on" stagger={2}>
        <rect
          {...LINE}
          x={34.5}
          y={32}
          width={9}
          height={9}
          rx={2}
          style={{ stroke: accent }}
        />
        <Dot cx={39} cy={36.5} r={1.5} color={accent} />
      </Part>
    </>
  ),
  "child-threads": (accent) => (
    <>
      <Node cx={8} cy={24} />
      <Branch start={[12.5, 24]} end={[24, 12]} />
      <Branch start={[12.5, 24]} end={[24, 24]} />
      <Branch start={[12.5, 24]} end={[24, 36]} />
      <ProgressBar
        x={24}
        y={12}
        width={20}
        value={0.75}
        animate="fill-in"
        stagger={1}
      />
      <ProgressBar
        x={24}
        y={24}
        width={20}
        value={0.45}
        color={accent}
        animate="fill-in"
        stagger={2}
      />
      <ProgressBar
        x={24}
        y={36}
        width={20}
        value={0.6}
        animate="fill-in"
        stagger={3}
      />
    </>
  ),
  "set-up-for-me": (accent) => (
    <>
      <Panel x={5} y={6} width={38} height={36} rx={4} />
      <Toggle x={10} y={12} on />
      <Rule x={24} y={15} width={13} soft />
      <Toggle x={10} y={22} on={false} animate="flip-on" stagger={1} />
      <Rule x={24} y={25} width={10} soft />
      <Slider
        x={10}
        y={35}
        width={28}
        knob={27}
        to={33}
        color={accent}
        animate="glide"
        stagger={2}
      />
    </>
  ),
  phone: (accent) => (
    <>
      <Phone x={14} y={4} />
      <ListLine x={19} y={15} width={5} soft={false} gap={3} />
      <ListLine x={19} y={22} width={6} gap={3} />
      <ListLine x={19} y={29} width={8} gap={3} />
      <ListLine
        x={19}
        y={34.5}
        width={7}
        gap={3}
        animate="flip-on"
        from="translateY(-3px)"
      />
      <Dot cx={31} cy={15} r={2} color={accent} animate="pop" stagger={2} />
    </>
  ),
  "browser-automation": (accent) => (
    <>
      <Window x={4} y={7} width={40} height={32} bar={6.5} />
      <Rule x={16} y={10.25} width={18} soft />
      <Rule x={9} y={19} width={14} />
      <Rule x={9} y={24} width={20} soft />
      <rect {...LINE} x={9} y={29} width={11} height={5} rx={1.5} />
      <Cursor x={22} y={27.5} animate="travel" />
      <Check cx={38.5} cy={35.5} color={accent} animate="pop" stagger={4} />
    </>
  ),
  "build-plugin": (accent) => (
    <>
      <Window x={3} y={6} width={34} height={30} />
      <Panel x={8} y={17} width={10} height={13} rx={1.5} soft fill={0} />
      <Rule x={22} y={19} width={10} soft />
      <Rule x={22} y={24} width={7} soft />
      <Wrench x={23} y={20} color={accent} animate="snap" />
    </>
  ),
  "open-threads-that-need-me": (accent) => (
    <>
      <Window x={4} y={6} width={40} height={36} />
      {PANES.map(([x, y], index) => (
        <g key={`${x}-${y}`}>
          <rect
            x={x}
            y={y}
            width={15}
            height={10}
            rx={1.5}
            stroke="currentColor"
            strokeWidth={1.1}
            fill="currentColor"
            fillOpacity={index === 1 ? 0.18 : 0.1}
            style={index === 1 ? { color: accent } : undefined}
          />
          {index === 1 ? null : (
            <Highlight
              x={x}
              y={y}
              width={15}
              height={10}
              color={accent}
              opacity={0.14}
              animate="flip-on"
              stagger={step(index + 1)}
            />
          )}
          <Rule x={x + 3} y={y + 4} width={7} soft />
          <Rule x={x + 3} y={y + 7} width={5} soft />
        </g>
      ))}
    </>
  ),
  "morning-digest": (accent) => (
    <>
      <Part animate="rise">
        <Panel x={12} y={5} width={24} height={24} rx={2} />
        <Rule x={16} y={11} width={12} />
        <rect
          x={16}
          y={15}
          width={14}
          height={1.5}
          rx={0.75}
          style={{ fill: accent }}
        />
        <Rule x={16} y={20} width={10} soft />
      </Part>
      <Envelope x={6} y={22.5} width={36} height={19.5} />
    </>
  ),
  "decision-buttons": (accent) => (
    <>
      <Bubble x={4} y={5} width={40} height={18} tail={[16, 6, 5]} />
      <Rule x={10} y={11} width={22} />
      <Rule x={10} y={16.5} width={15} soft />
      <Button x={6} y={31} width={17} color={accent} />
      <CheckMark x={10.5} y={36} color={accent} animate="pop" stagger={3} />
      <Button x={26} y={31} width={17} />
      <Cursor x={17} y={37.5} animate="flip-on" from="translate(8px, 6px)" />
    </>
  ),
  automations: (accent) => (
    <>
      <CalendarGrid x={5} y={8} width={30} height={30} />
      <Clock cx={35} cy={35} color={accent} animate="spin" />
    </>
  ),
  "queue-or-steer": (accent) => (
    <>
      <Bubble x={4} y={5} width={32} height={16} tail={[14, 5, 4]} />
      <Dot cx={13} cy={13} r={1.5} />
      <Dot cx={18} cy={13} r={1.5} />
      <Dot cx={23} cy={13} r={1.5} />
      <Part animate="slide-in">
        <Pill x={12} y={30} width={32} height={11} dashed />
        <Dot cx={18} cy={35.5} r={2} color={accent} />
        <Rule x={23} y={35.5} width={14} soft />
      </Part>
      <path {...LINE} strokeOpacity={0.4} d="M8 25v8a2.5 2.5 0 0 0 2.5 2.5" />
    </>
  ),
  "thread-search": (accent) => (
    <>
      {[9, 17, 25, 33].map((y, index) => (
        <ListLine key={y} x={6} y={y} width={index % 2 === 0 ? 16 : 12} />
      ))}
      <Magnifier cx={30} cy={26} animate="sweep">
        <Dot cx={25.5} cy={26} color={accent} />
        <Rule x={28.5} y={26} width={5} />
      </Magnifier>
    </>
  ),
  "command-palette": (accent) => (
    <>
      <Panel x={3} y={4} width={42} height={40} rx={4} />
      <SearchGlyph cx={9.5} cy={12} />
      <Rule x={16} y={12} width={8} soft />
      <Keycap x={29} y={7} label="⌘K" animate="press" />
      <Rule x={3} y={20.5} width={42} soft />
      <Part animate="fade-in" stagger={1}>
        <Highlight x={6} y={24} width={36} height={6} />
        <ListLine x={10} y={27} width={18} soft={false} dotColor={accent} />
      </Part>
      <ListLine x={10} y={34} width={14} animate="fade-in" stagger={2} />
      <ListLine x={10} y={40} width={20} animate="fade-in" stagger={3} />
    </>
  ),
  "another-agent": (accent) => (
    <>
      <Panel x={4} y={8} width={18} height={26} />
      <Rule x={8} y={15} width={10} />
      <Rule x={8} y={20} width={7} soft />
      <Rule x={8} y={25} width={9} soft />
      <Part animate="slide-in" stagger={1}>
        <Panel x={26} y={8} width={18} height={26} />
        <Rule x={30} y={15} width={10} />
        <Rule x={30} y={20} width={8} soft />
        <Dot cx={31} cy={26} r={1.75} color={accent} />
        <Rule x={34} y={26} width={6} soft />
      </Part>
      <Check cx={24} cy={39} color={accent} animate="pop" stagger={3} />
    </>
  ),
  "remote-access": (accent) => (
    <>
      <Window x={3} y={8} width={28} height={22} />
      <Rule x={8} y={18} width={14} soft />
      <Rule x={8} y={23} width={10} soft />
      <Phone x={33} y={14} width={12} height={24} />
      <Arrow
        d="M17 31v3a3 3 0 0 0 3 3h9"
        head="M29 34l3 3-3 3"
        color={accent}
        animate="nudge"
      />
      <Dot cx={39} cy={24} r={1.75} color={accent} animate="pop" stagger={2} />
    </>
  ),
  "bb-cli": (accent) => (
    <>
      <Window x={4} y={7} width={40} height={34} />
      <path {...LINE} d="M10 20l3.5 3-3.5 3" style={{ stroke: accent }} />
      <Rule x={17} y={23} width={12} animate="fill-in" from={0.45} />
      <Rule x={10} y={30} width={22} soft animate="fade-in" stagger={2} />
      <Rule x={10} y={35} width={16} soft animate="fade-in" stagger={3} />
    </>
  ),
  "add-agent": (accent) => (
    <>
      <Panel x={5} y={6} width={38} height={36} rx={4} />
      <ListLine x={11} y={14} width={20} soft={false} />
      <ListLine x={11} y={21} width={16} />
      <Part animate="slide-in" stagger={1}>
        <Pill x={9} y={29} width={30} height={9} dashed />
        <path {...LINE} d="M14 33.5h4M16 31.5v4" style={{ stroke: accent }} />
        <Rule x={21} y={33.5} width={13} soft />
      </Part>
    </>
  ),
  "provider-usage": (accent) => (
    <>
      <ChartAxes x={5} y={6} width={38} height={36} limit={13} />
      {USAGE_BARS.map(([x, height], index) => (
        <Bar
          key={x}
          x={x}
          baseline={42}
          height={height}
          color={index === 1 ? accent : undefined}
          animate="grow"
          stagger={step(index)}
        />
      ))}
    </>
  ),
};

export const ILLUSTRATION_IDS: readonly string[] = Object.keys(ILLUSTRATIONS);

export function TipArtStyles() {
  return <DiagramKitStyles />;
}

export function TipArt({
  illustration,
  tone,
}: {
  illustration: string;
  tone: TipTone;
}) {
  const draw = ILLUSTRATIONS[illustration];
  return <Diagram>{draw?.(TONE_COLOR[tone])}</Diagram>;
}

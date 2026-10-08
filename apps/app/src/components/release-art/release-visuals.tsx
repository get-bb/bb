import type { ReactNode } from "react";
import type { ReleaseVisualId } from "../../../../../changelog-metadata";
import {
  Branch,
  CANVAS,
  Bubble,
  CardStack,
  Clock,
  Dot,
  Highlight,
  LINE,
  ListLine,
  Node,
  Panel,
  Phone,
  Pill,
  Rule,
  Sparkle,
  Window,
  Wrench,
} from "./release-art-kit";

export type ReleaseArtTone = "blue" | "green" | "amber" | "orange";

export const TONE_COLOR: Record<ReleaseArtTone, string> = {
  blue: "var(--timeline-accent)",
  green: "var(--success)",
  amber: "var(--attention)",
  orange: "var(--warning)",
};

export interface ReleaseVisualDrawing {
  tone: ReleaseArtTone;
  draw: (accent: string) => ReactNode;
}

function Avatar({ cx, cy, color }: { cx: number; cy: number; color?: string }) {
  return (
    <g style={color === undefined ? undefined : { color }}>
      <Node cx={cx} cy={cy} r={5.2} />
      <circle {...LINE} cx={cx} cy={cy - 1.4} r={1.5} />
      <path {...LINE} d={`M${cx - 2.7} ${cy + 3.2}a2.9 2.6 0 0 1 5.4 0`} />
    </g>
  );
}

function Spoke({
  from,
  to,
}: {
  from: readonly [number, number];
  to: readonly [number, number];
}) {
  return <path {...LINE} d={`M${from[0]} ${from[1]}L${to[0]} ${to[1]}`} />;
}

export const RELEASE_VISUALS: Record<ReleaseVisualId, ReleaseVisualDrawing> = {
  "native-windows": {
    tone: "blue",
    draw: (accent) => (
      <>
        <Window x={4} y={6} width={40} height={30} />
        <Highlight
          x={15.5}
          y={14.5}
          width={8}
          height={8}
          rx={1}
          opacity={0.3}
        />
        <Highlight
          x={24.5}
          y={14.5}
          width={8}
          height={8}
          rx={1}
          color={accent}
          opacity={1}
        />
        <Highlight
          x={15.5}
          y={23.5}
          width={8}
          height={8}
          rx={1}
          opacity={0.3}
        />
        <Highlight
          x={24.5}
          y={23.5}
          width={8}
          height={8}
          rx={1}
          opacity={0.3}
        />
        <path {...LINE} d="M24 36v5M17 41h14" />
      </>
    ),
  },
  "diff-filter": {
    tone: "green",
    draw: (accent) => (
      <>
        <Panel x={4} y={9} width={30} height={34} />
        <Highlight x={7} y={12.5} width={24} height={5} />
        <path {...LINE} d="M9 15h3M10.5 13.5v3" />
        <Rule x={15} y={15} width={12} />
        <path {...LINE} strokeOpacity={0.4} d="M9 22h3" />
        <Rule x={15} y={22} width={9} soft />
        <Highlight x={7} y={26.5} width={24} height={5} />
        <path {...LINE} d="M9 29h3M10.5 27.5v3" />
        <Rule x={15} y={29} width={14} />
        <path {...LINE} strokeOpacity={0.4} d="M9 36h3" />
        <Rule x={15} y={36} width={7} soft />
        <path
          {...LINE}
          d="M30 5h14l-5 6.5v6l-4 2v-8Z"
          style={{ stroke: accent, fill: CANVAS }}
        />
      </>
    ),
  },
  "saved-drafts": {
    tone: "amber",
    draw: (accent) => (
      <>
        <CardStack x={5} y={15} width={30} height={26}>
          <Rule x={10} y={23} width={12} />
          <Rule x={10} y={28.5} width={18} soft />
          <Rule x={10} y={34} width={13} soft />
        </CardStack>
        <path d="M27 15v9.5l2.5-2 2.5 2V15Z" style={{ fill: accent }} />
      </>
    ),
  },
  "custom-environments": {
    tone: "green",
    draw: (accent) => (
      <>
        <Panel x={3} y={5} width={42} height={38} rx={5} fill={0} dashed soft />
        <Window x={9} y={12} width={30} height={24} />
        <path {...LINE} d="M14 23l3.5 3-3.5 3" style={{ stroke: accent }} />
        <Rule x={21} y={29} width={7} />
      </>
    ),
  },
  "account-pooler": {
    tone: "blue",
    draw: (accent) => (
      <>
        <Pill x={3} y={15} width={42} height={18} />
        <Avatar cx={12.5} cy={24} />
        <Avatar cx={24} cy={24} color={accent} />
        <Avatar cx={35.5} cy={24} />
      </>
    ),
  },
  "scheduled-send": {
    tone: "blue",
    draw: (accent) => (
      <>
        <Bubble x={4} y={5} width={32} height={19} tail={[14, 5, 5]} />
        <Rule x={10} y={11.5} width={18} />
        <Rule x={10} y={17} width={12} soft />
        <Clock cx={34} cy={34} color={accent} />
      </>
    ),
  },
  "file-editor": {
    tone: "blue",
    draw: (accent) => (
      <>
        <Window x={4} y={6} width={40} height={35} />
        <path {...LINE} strokeOpacity={0.4} d="M16 12v29" />
        <ListLine x={8} y={18} width={4} dot={1} gap={2.5} soft={false} />
        <ListLine x={8} y={23} width={4} dot={1} gap={2.5} />
        <ListLine x={8} y={28} width={4} dot={1} gap={2.5} />
        <Rule x={20} y={18} width={12} />
        <Rule x={23} y={23} width={14} soft />
        <Rule x={23} y={28} width={7} soft />
        <path {...LINE} d="M32 25.5v5" style={{ stroke: accent }} />
        <Rule x={20} y={34} width={9} />
      </>
    ),
  },
  "faster-threads": {
    tone: "green",
    draw: (accent) => (
      <>
        <Panel x={4} y={5} width={34} height={38} />
        <ListLine x={9} y={11} width={18} soft={false} />
        <ListLine x={9} y={17} width={22} />
        <ListLine x={9} y={23} width={14} />
        <ListLine x={9} y={29} width={20} />
        <ListLine x={9} y={35} width={12} />
        <path {...LINE} strokeOpacity={0.4} d="M42 8v32" />
        <path
          {...LINE}
          strokeWidth={2.4}
          d="M42 26v8"
          style={{ stroke: accent }}
        />
      </>
    ),
  },
  "extensions-page": {
    tone: "orange",
    draw: (accent) => (
      <>
        <Panel x={3} y={7} width={42} height={15} />
        <Panel x={7} y={10.5} width={8} height={8} rx={2} fill={0.18} />
        <Rule x={19} y={12.5} width={11} />
        <Rule x={19} y={17} width={7} soft />
        <Pill x={33} y={12} width={8} height={5} color={accent} />
        <Panel x={3} y={26} width={42} height={15} />
        <Panel x={7} y={29.5} width={8} height={8} rx={2} fill={0.18} />
        <Rule x={19} y={31.5} width={9} />
        <Rule x={19} y={36} width={12} soft />
        <Pill x={33} y={31} width={8} height={5} />
      </>
    ),
  },
  "fast-mobile": {
    tone: "amber",
    draw: (accent) => (
      <>
        <Phone x={9} y={4} />
        <ListLine x={14} y={15} width={6} soft={false} gap={3} />
        <ListLine x={14} y={22} width={7} gap={3} />
        <ListLine x={14} y={29} width={5} gap={3} />
        <path d="M39 13l-6 10h4.5l-2 9 6.5-11h-4.5Z" style={{ fill: accent }} />
      </>
    ),
  },
  fixes: {
    tone: "orange",
    draw: (accent) => (
      <>
        <Window x={3} y={6} width={34} height={30} />
        <ListLine x={8} y={18} width={14} />
        <ListLine x={8} y={24} width={10} />
        <ListLine x={8} y={30} width={6} />
        <Wrench x={22} y={21} color={accent} />
      </>
    ),
  },
  plugins: {
    tone: "amber",
    draw: (accent) => (
      <>
        <path
          {...LINE}
          fill="currentColor"
          fillOpacity={0.1}
          d="M7 17h7.5a3.5 3.5 0 0 1 7 0H29v7.5a3.5 3.5 0 0 1 0 7V39H7Z"
        />
        <Sparkle cx={38} cy={11} color={accent} />
      </>
    ),
  },
  "multiple-choice": {
    tone: "blue",
    draw: (accent) => (
      <>
        <Bubble x={4} y={4} width={40} height={14} tail={[14, 5, 4]} />
        <Rule x={10} y={11} width={20} />
        <circle {...LINE} cx={10} cy={27} r={2.2} />
        <Rule x={15} y={27} width={14} soft />
        <Highlight x={5} y={30.5} width={34} height={7} color={accent} />
        <circle {...LINE} cx={10} cy={34} r={2.2} style={{ stroke: accent }} />
        <Dot cx={10} cy={34} r={1.1} color={accent} />
        <Rule x={15} y={34} width={18} />
        <circle {...LINE} cx={10} cy={41} r={2.2} />
        <Rule x={15} y={41} width={11} soft />
      </>
    ),
  },
  "quiet-updates": {
    tone: "blue",
    draw: (accent) => (
      <>
        <path {...LINE} d="M33.5 20.5A12 12 0 1 1 23 14" />
        <path {...LINE} d="M20 11l3 3-3 3" />
        <path {...LINE} d="M22.5 21v9M19 26.5l3.5 3.5 3.5-3.5" />
        <Dot cx={35} cy={12} r={2.5} color={accent} />
      </>
    ),
  },
  "split-views": {
    tone: "blue",
    draw: (accent) => (
      <>
        <Window x={3} y={6} width={42} height={36} />
        <Panel x={7} y={16} width={10} height={22} rx={2} />
        <g style={{ color: accent }}>
          <Panel x={19} y={16} width={10} height={22} rx={2} fill={0.18} />
        </g>
        <Panel x={31} y={16} width={10} height={22} rx={2} />
        <Rule x={9.5} y={21} width={5} soft />
        <Rule x={21.5} y={21} width={5} />
        <Rule x={33.5} y={21} width={5} soft />
      </>
    ),
  },
  "multi-machine": {
    tone: "green",
    draw: (accent) => (
      <>
        <Panel x={3} y={7} width={17} height={13} rx={2} />
        <path {...LINE} d="M11.5 20v3M8 23h7" />
        <Panel x={28} y={25} width={17} height={13} rx={2} />
        <path {...LINE} d="M36.5 38v3M33 41h7" />
        <Branch start={[20, 13.5]} end={[28, 31.5]} />
        <Dot cx={24} cy={22.5} r={2.4} color={accent} />
      </>
    ),
  },
  "more-agents": {
    tone: "orange",
    draw: (accent) => (
      <>
        <Spoke from={[19.8, 20.4]} to={[12, 13.6]} />
        <Spoke from={[28.2, 20.4]} to={[36, 13.6]} />
        <Spoke from={[19.8, 27.6]} to={[12, 34.4]} />
        <Spoke from={[28.2, 27.6]} to={[36, 34.4]} />
        <Node cx={24} cy={24} r={5.5} />
        <Node cx={9} cy={11} r={4} />
        <Node cx={39} cy={11} r={4} />
        <Node cx={9} cy={37} r={4} />
        <Node cx={39} cy={37} r={4} color={accent} />
      </>
    ),
  },
};

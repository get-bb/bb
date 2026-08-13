import { memo } from "react";
import { Badge } from "@bb/shared-ui/badge";
import {
  STRIDE_SEGMENTS,
  type StrideSegment,
  type ThreatAggregate,
} from "./aggregate.js";

const SEGMENT_GLYPHS: Record<StrideSegment, string> = {
  spoofing: "S",
  tampering: "T",
  repudiation: "R",
  information_disclosure: "I",
  denial_of_service: "D",
  elevation_of_privilege: "E",
};

interface StrideMicroBarProps {
  aggregate: ThreatAggregate;
  labels: Record<StrideSegment, string>;
}

export const StrideMicroBar = memo(function StrideMicroBar({
  aggregate,
  labels,
}: StrideMicroBarProps): React.JSX.Element | null {
  if (aggregate.total === 0) return null;
  const summary = STRIDE_SEGMENTS.map(
    (category) => `${labels[category]} ${aggregate.counts[category]}`,
  ).join(", ");
  return (
    <div
      aria-label={`${aggregate.total} open threats on ${aggregate.targetSlug}. ${summary}. Other ${aggregate.counts.other}.`}
      className="flex w-52 items-stretch gap-0.5 rounded-md border border-border bg-card/95 p-1 text-card-foreground shadow-sm"
      data-stride-target={aggregate.targetSlug}
      role="img"
    >
      {STRIDE_SEGMENTS.map((category) => {
        const count = aggregate.counts[category];
        return (
          <span
            aria-label={`${labels[category]}: ${count}`}
            className={`flex min-w-5 items-center justify-center gap-0.5 rounded-sm border px-1 py-0.5 font-mono text-xs font-semibold tabular-nums ${
              count > 0
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border bg-muted text-muted-foreground"
            }`}
            key={category}
            style={{ flexGrow: Math.max(1, count) }}
            title={`${labels[category]}: ${count}`}
          >
            <span aria-hidden="true">{SEGMENT_GLYPHS[category]}</span>
            <span>{count}</span>
          </span>
        );
      })}
      {aggregate.counts.other > 0 ? (
        <Badge
          aria-label={`Other methodology categories: ${aggregate.counts.other}`}
          className="h-auto px-1 font-mono text-xs tabular-nums"
          variant="outline"
        >
          O {aggregate.counts.other}
        </Badge>
      ) : null}
    </div>
  );
});

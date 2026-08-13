import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Icon } from "@bb/shared-ui/icon";
import type { TraceRailModel } from "./resolvers.js";
import { TraceNode } from "./TraceNode.js";

export function TraceabilityRail({
  rail,
  onNavigate,
}: {
  rail: TraceRailModel;
  onNavigate?(subPath: string): void;
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rail.nodes.length,
    estimateSize: () => 244,
    getScrollElement: () => scrollRef.current,
    horizontal: true,
    initialRect: { width: 960, height: 210 },
    overscan: 2,
  });
  return (
    <section aria-label={`Traceability chain for ${rail.requirementId}`} className="space-y-3">
      <header className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-4 text-primary" name="Workflow" />
        <h2 className="text-sm font-semibold">Inspectable trace</h2>
        <p className="text-xs text-muted-foreground">Mapping context is not compliance proof.</p>
      </header>
      <div
        aria-label="Horizontal trace rail"
        className="overflow-x-auto pb-2"
        ref={scrollRef}
        role="list"
        tabIndex={0}
      >
        <div className="relative h-48" style={{ width: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((item) => {
            const node = rail.nodes[item.index];
            if (!node) return null;
            return (
              <div
                className="absolute left-0 top-0 h-48 w-60 pr-4"
                data-trace-node
                key={`${node.kind}:${node.id}`}
                role="listitem"
                style={{ transform: `translateX(${item.start}px)` }}
              >
                <TraceNode node={node} onNavigate={onNavigate} />
                {item.index < rail.nodes.length - 1 ? (
                  <Icon aria-hidden="true" className="absolute right-0 top-20 size-4 text-muted-foreground" name="ArrowRight" />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {rail.gaps.length > 0 ? (
        <div aria-label="Traceability gaps" className="grid gap-2 md:grid-cols-2" role="region">
          {rail.gaps.map((item, index) => (
            <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs" key={`${item.from}:${item.to}:${index}`} role="status">
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" name="AlertTriangle" />
              <div>
                <p className="font-mono font-semibold text-foreground">{item.from} → {item.to}</p>
                <p className="mt-1 leading-5 text-muted-foreground">{item.reason}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

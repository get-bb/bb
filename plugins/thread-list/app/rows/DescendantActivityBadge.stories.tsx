import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DescendantActivityBadge,
  descendantActivityLabel,
} from "./DescendantActivityBadge.js";

export default { title: "plugins/Thread list/Descendant activity badge" };

const ITEMS = [
  { id: "thr_a", label: "Rebuild the index" },
  { id: "thr_b", label: "Backfill shards" },
];

function Row({
  title,
  items,
}: {
  title: string;
  items: readonly { id: string; label: string }[];
}) {
  return (
    <div className="flex h-7 w-72 items-center gap-2 rounded-md px-2 text-sidebar-foreground hover:bg-sidebar-accent">
      <span className="truncate text-sm">{title}</span>
      <span className="ml-auto flex items-center gap-1">
        <DescendantActivityBadge items={items} onSelect={() => {}} />
        <span className="h-4 w-4 rounded-full border border-current opacity-40" />
      </span>
    </div>
  );
}

export function Badges() {
  return (
    <TooltipProvider>
      <div className="w-80 space-y-1 bg-sidebar p-4">
        <Row title="Two descendants working" items={ITEMS} />
        <Row title="One descendant working" items={ITEMS.slice(0, 1)} />
        <Row title="No descendants working" items={[]} />
      </div>
    </TooltipProvider>
  );
}

export function Labels() {
  return (
    <div className="space-y-2 bg-sidebar p-4 text-sidebar-foreground">
      {[1, 2, 3].map((n) => (
        <div key={n} className="text-sm">
          {n}: {descendantActivityLabel(n)}
        </div>
      ))}
    </div>
  );
}

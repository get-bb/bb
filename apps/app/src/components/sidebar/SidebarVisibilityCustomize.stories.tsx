import { useState } from "react";
import { Icon, type BuiltinIconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { SplitPreviewProvider } from "@/lib/define-split";
import {
  SidebarVisibilityCustomize,
  type SidebarVisibilityItem,
} from "./SidebarVisibilityControls";

export default { title: "performance/Sidebar visibility split" };

type ReviewState = "loading" | "error" | "live";

const ITEMS: readonly (SidebarVisibilityItem & {
  iconName: BuiltinIconName;
})[] = [
  { id: "new-thread", title: "New thread", iconName: "MessageSquarePlus" },
  { id: "search", title: "Search threads", iconName: "Search" },
  { id: "plugins", title: "Plugins", iconName: "Plug02" },
  { id: "skills", title: "Skills", iconName: "Zap" },
  { id: "automations", title: "Automations", iconName: "Clock" },
  {
    id: "workflows",
    title: "Workflows",
    iconName: "Workflow",
    disabled: true,
  },
];

function Review({
  initial,
  variant,
}: {
  initial: ReviewState;
  variant: "compact" | "card";
}) {
  const [state, setState] = useState<ReviewState>(initial);
  const [open, setOpen] = useState(true);
  const [order, setOrder] = useState(() => ITEMS.map((item) => item.id));
  const [visibleIds, setVisibleIds] = useState<readonly string[]>([
    "new-thread",
    "search",
    "plugins",
  ]);
  const items = order.flatMap((id) => {
    const item = ITEMS.find((candidate) => candidate.id === id);
    return item
      ? [
          {
            ...item,
            icon: <Icon name={item.iconName} aria-hidden="true" />,
          },
        ]
      : [];
  });
  const customize = (
    <SidebarVisibilityCustomize
      title="Customize sidebar"
      listLabel="Sidebar navigation"
      variant={variant}
      items={items}
      visibleIds={visibleIds}
      onDone={() => setOpen(false)}
      onReorder={(activeId, overId) =>
        setOrder((current) => {
          const next = current.filter((id) => id !== activeId);
          next.splice(next.indexOf(overId), 0, activeId);
          return next;
        })
      }
      onVisibleChange={(id, visible) =>
        setVisibleIds((current) =>
          visible
            ? [...current, id]
            : current.filter((candidate) => candidate !== id),
        )
      }
    />
  );
  return (
    <div className="space-y-3 p-3">
      <div
        className="flex flex-wrap gap-3 text-sm"
        aria-label="Split review controls"
      >
        <button type="button" onClick={() => setState("loading")}>
          Hold loading
        </button>
        <button type="button" onClick={() => setState("error")}>
          Show failure
        </button>
        <button type="button" onClick={() => setState("live")}>
          Release to real UI
        </button>
        <button type="button" onClick={() => setOpen(true)}>
          Reopen
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {SidebarVisibilityCustomize.id}: {state}
        {open ? "" : " (closed by Done)"}
      </p>
      <div
        data-review-sidebar
        className={cn(
          "flex w-full flex-col bg-sidebar text-sidebar-foreground",
          variant === "compact" ? "h-[560px]" : "max-w-64",
        )}
      >
        {open ? (
          <div
            className={cn(
              "px-2 py-2",
              variant === "compact"
                ? "flex min-h-0 flex-1 flex-col"
                : "shrink-0",
            )}
            data-review-customize
          >
            {state === "live" ? (
              customize
            ) : (
              <SplitPreviewProvider
                id={SidebarVisibilityCustomize.id}
                state={state}
                onRetry={() => setState("live")}
              >
                {customize}
              </SplitPreviewProvider>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const DesktopCard = () => <Review initial="loading" variant="card" />;

export const DesktopCardFailure = () => (
  <Review initial="error" variant="card" />
);

export const DesktopCardLoaded = () => <Review initial="live" variant="card" />;

export const PhoneCompact = () => (
  <Review initial="loading" variant="compact" />
);

export const PhoneCompactFailure = () => (
  <Review initial="error" variant="compact" />
);

export const PhoneCompactLoaded = () => (
  <Review initial="live" variant="compact" />
);

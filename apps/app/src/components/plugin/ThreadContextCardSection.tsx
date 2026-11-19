import { createContext, useCallback, useContext, useId } from "react";
import { useAtom } from "jotai";
import type { ExperimentalInfoSectionProps } from "@get-bb/plugin-sdk";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  InfoCountPill,
  InfoSection,
} from "@/components/secondary-panel/info/info-list";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

const collapsedSectionsAtom = createSyncedPreferenceAtom(
  "threadContextCard.collapsedSections",
);

export type ThreadContextCardSectionScope =
  | { kind: "foldable"; sectionKey: string }
  | { kind: "legacyFrame" };

export const ThreadContextCardSectionScopeContext =
  createContext<ThreadContextCardSectionScope | null>(null);

export function useThreadContextCardSectionFold(sectionKey: string): {
  open: boolean;
  toggle: () => void;
} {
  const [collapsedKeys, setCollapsedKeys] = useAtom(collapsedSectionsAtom);
  const open = !collapsedKeys.includes(sectionKey);
  const toggle = useCallback(() => {
    const nextCollapsed = open;
    setCollapsedKeys((keys) => {
      const without = keys.filter((key) => key !== sectionKey);
      return nextCollapsed ? [...without, sectionKey] : without;
    });
  }, [open, sectionKey, setCollapsedKeys]);
  return { open, toggle };
}

const SECTION_TOGGLE_CLASS =
  "flex h-6.5 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-left font-medium text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-md:pointer-coarse:h-9";

export function ThreadContextCardSectionTitle({
  label,
  count,
  open,
  bodyId,
  onToggle,
}: {
  label: string;
  count?: number;
  open: boolean;
  bodyId: string;
  onToggle: () => void;
}) {
  return (
    <h3 className="m-0 min-w-0 flex-1 text-xs">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className={SECTION_TOGGLE_CLASS}
      >
        <span className="flex min-w-0 items-center">
          <span className="min-w-0 truncate">{label}</span>
          {count === undefined ? null : <InfoCountPill count={count} />}
        </span>
        <Icon
          name="ChevronDown"
          aria-hidden="true"
          className={cn(
            "ml-auto size-3.5 shrink-0 text-subtle-foreground",
            open && "rotate-180",
          )}
        />
      </button>
    </h3>
  );
}

function FoldableThreadContextCardSection({
  sectionKey,
  label,
  count,
  accessory,
  trailing,
  children,
}: ExperimentalInfoSectionProps & { sectionKey: string }) {
  const { open, toggle } = useThreadContextCardSectionFold(sectionKey);
  const bodyId = useId();
  return (
    <section aria-label={label} className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        <ThreadContextCardSectionTitle
          label={label}
          count={count}
          open={open}
          bodyId={bodyId}
          onToggle={toggle}
        />
        {open ? accessory : null}
        {open ? trailing : null}
      </div>
      {open ? (
        <div id={bodyId}>
          <ThreadContextCardSectionScopeContext.Provider value={null}>
            {children}
          </ThreadContextCardSectionScopeContext.Provider>
        </div>
      ) : null}
    </section>
  );
}

export function SurfaceInfoSection(props: ExperimentalInfoSectionProps) {
  const scope = useContext(ThreadContextCardSectionScopeContext);
  if (scope === null) return <InfoSection {...props} />;
  if (scope.kind === "legacyFrame") return props.children;
  return (
    <FoldableThreadContextCardSection
      {...props}
      sectionKey={scope.sectionKey}
    />
  );
}

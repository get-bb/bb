import { createContext, useCallback, useContext, useId } from "react";
import { useAtom } from "jotai";
import type { ExperimentalInfoSectionProps } from "@get-bb/plugin-sdk";
import {
  InfoSection,
  InfoSectionHeading,
  type InfoSectionCollapse,
} from "@/components/secondary-panel/info/info-list";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

const collapsedSectionsAtom = createSyncedPreferenceAtom(
  "threadContextCard.collapsedSections",
);

export const THREAD_CONTEXT_CARD_SECTION_HEADING_CLASS = "px-2";

export type ThreadContextCardSectionScope =
  | { kind: "foldable"; sectionKey: string }
  | { kind: "legacyFrame" };

export const ThreadContextCardSectionScopeContext =
  createContext<ThreadContextCardSectionScope | null>(null);

export function useThreadContextCardSectionCollapse(
  sectionKey: string,
): InfoSectionCollapse {
  const [collapsedKeys, setCollapsedKeys] = useAtom(collapsedSectionsAtom);
  const setCollapsed = useCallback(
    (nextCollapsed: boolean) => {
      setCollapsedKeys((keys) => {
        const without = keys.filter((key) => key !== sectionKey);
        return nextCollapsed ? [...without, sectionKey] : without;
      });
    },
    [sectionKey, setCollapsedKeys],
  );
  return { collapsed: collapsedKeys.includes(sectionKey), setCollapsed };
}

function FoldableThreadContextCardSection({
  sectionKey,
  children,
  ...heading
}: ExperimentalInfoSectionProps & { sectionKey: string }) {
  const collapse = useThreadContextCardSectionCollapse(sectionKey);
  const bodyId = useId();
  return (
    <section aria-label={heading.label} className="min-w-0">
      <InfoSectionHeading
        {...heading}
        collapse={collapse}
        bodyId={bodyId}
        className={THREAD_CONTEXT_CARD_SECTION_HEADING_CLASS}
      />
      {collapse.collapsed ? null : (
        <div id={bodyId}>
          <ThreadContextCardSectionScopeContext.Provider value={null}>
            {children}
          </ThreadContextCardSectionScopeContext.Provider>
        </div>
      )}
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

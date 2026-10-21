import { createContext, useContext, type ComponentProps } from "react";
import type {
  WorkspaceChangedFileSelection,
  WorkspaceChangedFilesSection,
} from "bb-plugin-bb--git/workspace-change-summary";
import {
  ComposerGitPresentation,
  type ComposerGitPresentationProps,
} from "bb-plugin-bb--git/ComposerSegment";
import { ThreadPromptContextBanner as CoreBanner } from "./ThreadPromptContextBanner";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import {
  setPluginSlotRegistrations,
  resetPluginSlotStoreForTest,
} from "@/lib/plugin-slots";

export interface ThreadPromptGitSection {
  changedFiles: WorkspaceChangedFilesSection;
  mergeBase: ComposerGitPresentationProps["mergeBase"];
  onPromptBannerFileClick: (selection: WorkspaceChangedFileSelection) => void;
}
type FixtureProps = Omit<
  ComponentProps<typeof CoreBanner>,
  "expandedSection"
> & {
  expandedSection: ComponentProps<typeof CoreBanner>["expandedSection"] | "git";
} & { gitSection: ThreadPromptGitSection | null; gitSectionPending: boolean };
const Fixture = createContext<FixtureProps | null>(null);

export function installGitBannerFixture(reset = true) {
  if (reset) resetPluginSlotStoreForTest();
  setPluginSlotRegistrations(
    "bb--git",
    collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.slots.experimental_threadContextSegment({
          id: "changes",
          title: "Changed files",
          useVisible() {
            const fixture = useContext(Fixture);
            return Boolean(
              fixture?.gitSection &&
              !fixture.gitSectionPending &&
              !fixture.archivedSection &&
              !fixture.environmentGoneSection,
            );
          },
          component: function GitBannerFixture(props) {
            const fixture = useContext(Fixture);
            const section = fixture?.gitSection;
            if (!section) return null;
            return (
              <ComposerGitPresentation
                {...props}
                isExpanded={
                  props.isExpanded || fixture.expandedSection === "git"
                }
                section={section.changedFiles}
                mergeBase={section.mergeBase}
                onFileClick={(file) =>
                  section.onPromptBannerFileClick({
                    file,
                    section: section.changedFiles,
                  })
                }
              />
            );
          },
        });
      }),
    ),
  );
}
export function ThreadPromptContextBanner({
  gitSection,
  gitSectionPending,
  ...props
}: FixtureProps) {
  return (
    <Fixture.Provider value={{ ...props, gitSection, gitSectionPending }}>
      <CoreBanner
        {...props}
        expandedSection={
          props.expandedSection === "git" ? null : props.expandedSection
        }
      />
    </Fixture.Provider>
  );
}

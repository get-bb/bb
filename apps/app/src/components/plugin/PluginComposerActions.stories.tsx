import { useEffect, useState, type ComponentType } from "react";
import { MemoryRouter } from "react-router-dom";
import type { ComposerView } from "@bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  makeAttachmentsConfig,
  makeThreadListEntry,
  makeTypeaheadConfig,
} from "../../../.ladle/story-fixtures";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";
import { PromptBoxInternal } from "@/components/promptbox/PromptBoxInternal";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { useComposer } from "@/lib/plugin-sdk-hooks";
import {
  ThreadRow,
  type ThreadRowOptions,
} from "@/components/sidebar/ThreadRow";
import { PluginComposerActions } from "./PluginComposerActions";

export default {
  title: "plugins/Composer actions",
};

const THREAD_ID = "thr_plugin_composer_story";
const PROJECT_ID = "proj_plugin_composer_story";

const NEW_THREAD_VIEW: ComposerView = {
  scope: { kind: "new-thread", projectId: PROJECT_ID },
  layout: "expanded",
  draft: { text: "", isEmpty: true, attachmentCount: 0 },
  run: { isRunning: false, isSubmitting: false },
};

const THREAD_VIEW: ComposerView = {
  ...NEW_THREAD_VIEW,
  scope: { kind: "thread", threadId: THREAD_ID },
};
const THREAD_SCOPES: ComposerView["scope"]["kind"][] = ["thread"];

function registrations(
  actions: NonNullable<
    NonNullable<
      PluginRegistrationSet["composerCustomizations"]
    >[number]["actions"]
  >,
  scopes: ComposerView["scope"]["kind"][] = ["new-thread", "thread"],
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerCustomizations: [{ id: "story-actions", scopes, actions }],
    pendingInteractions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    messageActions: [],
  };
}

function StoryPluginRegistration({
  pluginId,
  actions,
  scopes,
}: {
  pluginId: string;
  actions: Parameters<typeof registrations>[0];
  scopes?: ComposerView["scope"]["kind"][];
}) {
  useEffect(() => {
    setPluginSlotRegistrations(pluginId, registrations(actions, scopes));
    return () => removePluginSlotRegistrations(pluginId);
  }, [actions, pluginId, scopes]);
  return null;
}

function compactAction(label: string, icon: IconName): ComponentType {
  return function StoryComposerAction() {
    return (
      <Button type="button" size="icon" variant="ghost" aria-label={label}>
        <Icon name={icon} className="size-4" aria-hidden />
      </Button>
    );
  };
}

const OVERFLOW_PLUGINS = [
  ["story-composer-alpha", "Improve", "Zap"],
  ["story-composer-beta", "Search", "Search"],
  ["story-composer-gamma", "Plan", "ListTodo"],
  ["story-composer-delta", "Attach", "FileAttachment"],
  ["story-composer-epsilon", "Review", "Check"],
] as const satisfies readonly (readonly [string, string, IconName])[];

const OVERFLOW_REGISTRATIONS = OVERFLOW_PLUGINS.map(
  ([pluginId, label, icon]) => ({
    actions: [{ id: "primary", component: compactAction(label, icon) }],
    pluginId,
  }),
);

function OverflowFixture() {
  const [value, setValue] = useState("");
  return (
    <>
      {OVERFLOW_REGISTRATIONS.map(({ pluginId, actions }) => (
        <StoryPluginRegistration
          key={pluginId}
          pluginId={pluginId}
          actions={actions}
        />
      ))}
      <div className="w-full max-w-xl">
        <PromptBoxInternal
          value={value}
          mentionRanges={[]}
          onChange={(nextValue) => setValue(nextValue)}
          onSubmit={() => {}}
          placeholder="Ask a follow-up"
          typeahead={makeTypeaheadConfig()}
          mentionMenuPlacement="top"
          attachments={makeAttachmentsConfig()}
          submission={{
            isSubmitting: false,
            disabled: false,
            title: "Submit (Enter)",
          }}
        />
      </div>
    </>
  );
}

function SetValidStatus() {
  const composer = useComposer();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() =>
        composer.setThreadRowStatus({
          icon: "Zap",
          label: "Improving draft",
          tone: "success",
        })
      }
    >
      Set valid
    </Button>
  );
}

function RejectBlankStatus() {
  const composer = useComposer();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() =>
        (composer.setThreadRowStatus as (status: unknown) => void)({
          icon: "Zap",
          label: "   ",
        })
      }
    >
      Reject blank
    </Button>
  );
}

function RejectMalformedStatus() {
  const composer = useComposer();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() =>
        (composer.setThreadRowStatus as (status: unknown) => void)([
          "malformed",
        ])
      }
    >
      Reject array
    </Button>
  );
}

function ClearStatus() {
  const composer = useComposer();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => composer.setThreadRowStatus(null)}
    >
      Clear
    </Button>
  );
}

const STATUS_ACTIONS = [
  { id: "valid", component: SetValidStatus },
  { id: "blank", component: RejectBlankStatus },
  { id: "malformed", component: RejectMalformedStatus },
  { id: "clear", component: ClearStatus },
] as const;

const THREAD_ROW_OPTIONS: ThreadRowOptions = {
  kind: "default",
  depth: 1,
  isCompact: false,
};

function StatusValidationFixture() {
  return (
    <MemoryRouter initialEntries={[`/threads/${THREAD_ID}`]}>
      <StoryPluginRegistration
        pluginId="story-composer-status"
        actions={STATUS_ACTIONS}
        scopes={THREAD_SCOPES}
      />
      <div className="grid max-w-3xl gap-4 md:grid-cols-[20rem_1fr]">
        <ThreadActionsProvider>
          <div className="rounded-md bg-sidebar p-2 text-sidebar-foreground">
            <SidebarMenu>
              <SidebarMenuItem>
                <ThreadRow
                  projectId={PROJECT_ID}
                  thread={makeThreadListEntry({
                    id: THREAD_ID,
                    projectId: PROJECT_ID,
                    title: "Plugin status validation",
                    titleFallback: "Plugin status validation",
                  })}
                  isActive={false}
                  hasComposerDraft
                  options={THREAD_ROW_OPTIONS}
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </div>
        </ThreadActionsProvider>
        <div className="rounded-xl border bg-background p-3">
          <p className="mb-3 text-sm text-muted-foreground">
            Set a valid status, then try either rejected payload. The green row
            status remains until Clear because invalid updates are ignored.
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <PluginComposerActions view={THREAD_VIEW} />
          </div>
        </div>
      </div>
    </MemoryRouter>
  );
}

export function Overflow() {
  return (
    <StoryCard>
      <StoryRow
        label="five plugins"
        hint="three plugin groups inline; use an overflow action, close the menu, and it is promoted by usage"
      >
        <OverflowFixture />
      </StoryRow>
    </StoryCard>
  );
}

export function StatusValidation() {
  return (
    <StoryCard>
      <StoryRow
        label="valid and rejected status"
        hint="blank and malformed status payloads preserve the last valid thread-row glyph"
      >
        <StatusValidationFixture />
      </StoryRow>
    </StoryCard>
  );
}

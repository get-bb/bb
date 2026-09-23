import { useEffect, useState, type ComponentType } from "react";
import type { ComposerView } from "@get-bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  makeAttachmentsConfig,
  makeTypeaheadConfig,
} from "../../../.ladle/story-fixtures";
import { PromptBoxInternal } from "@/components/promptbox/PromptBoxInternal";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

export default {
  title: "plugins/Composer actions",
};

function registrations(
  actions: NonNullable<
    NonNullable<
      PluginRegistrationSet["composerCustomizations"]
    >[number]["actions"]
  >,
  scopes: ComposerView["scope"]["kind"][] = ["new-thread", "thread"],
): PluginRegistrationSet {
  return makePluginRegistrationSet({
    composerCustomizations: [{ id: "story-actions", scopes, actions }],
  });
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

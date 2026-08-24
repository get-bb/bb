// Dev-only exercise screen for the shared composer: mentions typeahead
// (@ threads/projects/files, / commands), attachments (library / camera /
// file), voice, "+" actions, and the submit modes, against the active
// server. Not product UI.
import { composerValueToPromptInput } from "@/composer";
import type { PromptDraftAttachment } from "@bb/client-core";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProfiles } from "@/app-shell";
import {
  Composer,
  emptyComposerValue,
  type ComposerSubmitMode,
  type ComposerValue,
} from "@/composer";
import { useSidebarBootstrap } from "@/data/sidebar";
import { useSystemProviders } from "@/data/system";
import {
  Button,
  EmptyStatePanel,
  COMPOSER_KEYBOARD_GAP,
  KeyboardPaddingView,
  OverlayBounds,
  Text,
  toast,
} from "@/ui";
import { Screen } from "../shell/Screen";

const MODES: { key: string; label: string; mode: ComposerSubmitMode }[] = [
  { key: "ready", label: "ready", mode: "ready" },
  {
    key: "queue",
    label: "queue",
    mode: { kind: "queue", onStop: () => toast.info("stop") },
  },
  {
    key: "stop-only",
    label: "stop-only",
    mode: { kind: "stop-only", onStop: () => toast.info("stop") },
  },
  {
    key: "blocked",
    label: "blocked",
    mode: { kind: "blocked", reason: "pending-interaction" },
  },
];

export function ComposerShowcaseScreen() {
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <Screen testID="dev-composer-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </Screen>
    );
  }
  return <ConnectedComposerShowcase />;
}

function ConnectedComposerShowcase() {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState<ComposerValue>(emptyComposerValue);
  const [attachments, setAttachments] = useState<PromptDraftAttachment[]>([]);
  const [modeKey, setModeKey] = useState("ready");
  const [lastSubmit, setLastSubmit] = useState<string | null>(null);
  const sidebar = useSidebarBootstrap();
  const providers = useSystemProviders();
  const projectId =
    sidebar.data?.projects[0]?.id ?? sidebar.data?.personalProject.id ?? null;
  const providerId = providers.data?.[0]?.id ?? null;
  const mode = MODES.find((entry) => entry.key === modeKey)?.mode ?? "ready";
  const serialized = useMemo(
    () =>
      JSON.stringify(composerValueToPromptInput(value, attachments), null, 2),
    [attachments, value],
  );
  return (
    <Screen scroll={false} testID="dev-composer-screen">
      <KeyboardPaddingView
        style={{ flex: 1 }}
        keyboardGap={COMPOSER_KEYBOARD_GAP}
      >
        {/* Same bounds as the product screens, so the showcase exercises
            the typeahead's height cap. */}
        <OverlayBounds style={{ flex: 1 }}>
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16, gap: 12 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <Text variant="caption">
              Project {projectId ?? "—"}
              {projectId === PERSONAL_PROJECT_ID ? " (personal)" : ""} ·
              provider {providerId ?? "—"}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {MODES.map((entry) => (
                <Button
                  key={entry.key}
                  size="sm"
                  variant={entry.key === modeKey ? "default" : "outline"}
                  onPress={() => setModeKey(entry.key)}
                  testID={`dev-composer-mode-${entry.key}`}
                >
                  {entry.label}
                </Button>
              ))}
            </View>
            <Text variant="sectionLabel">PromptInput</Text>
            <Text variant="mono" selectable testID="dev-composer-serialized">
              {serialized}
            </Text>
            {lastSubmit ? (
              <Text variant="caption" testID="dev-composer-last-submit">
                submitted: {lastSubmit}
              </Text>
            ) : null}
          </ScrollView>
          <View
            className="border-t border-border-hairline bg-background px-3 pt-2"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            <Composer
              value={value}
              onChange={setValue}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              scope={{ projectId, providerId }}
              submitMode={mode}
              onSubmit={(kind) => {
                setLastSubmit(
                  `${kind} ${JSON.stringify(composerValueToPromptInput(value, attachments))}`,
                );
                toast.success(`Submit: ${kind}`);
              }}
              placeholder="Try @, /, + and the mic…"
              testID="dev-composer"
            />
          </View>
        </OverlayBounds>
      </KeyboardPaddingView>
    </Screen>
  );
}

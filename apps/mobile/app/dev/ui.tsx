// Dev-only gallery: renders every primitive in src/ui so the design system
// can be eyeballed per palette × mode on the simulator. Not product UI.
import { BUILTIN_THEME_IDS } from "@bb/domain";
import { Redirect } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { e2eModeEnabled } from "@/app-shell";
import { VoiceBar, type VoiceBarController } from "@/composer";
import { useTheme } from "@/theme/ThemeProvider";
import type { ThemeModePreference } from "@/theme/theme-preference";
import {
  ActionSheet,
  Badge,
  Button,
  EmptyState,
  EmptyStatePanel,
  ICON_NAMES,
  Icon,
  Input,
  ListRow,
  Pill,
  Separator,
  Sheet,
  Skeleton,
  Spinner,
  Switch,
  Text,
  TextArea,
  toast,
  useSheet,
} from "@/ui";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <Text variant="sectionLabel">{title}</Text>
      {children}
    </View>
  );
}

const MODES: ThemeModePreference[] = ["system", "light", "dark"];

/**
 * Speech-like synthetic input levels for the voice bar showcase: a slow
 * syllable envelope with jitter, so the waveform scrolls without a mic.
 */
function syntheticVoiceLevel(): number {
  const t = Date.now() / 1000;
  const syllable =
    Math.max(0, Math.sin(t * 5.3)) * (0.6 + 0.4 * Math.sin(t * 0.7));
  const pause = Math.sin(t * 0.45) > 0.75 ? 0 : 1;
  const jitter = 0.75 + Math.random() * 0.25;
  return Math.min(1, 0.06 + syllable * jitter * pause);
}

function UiGalleryScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [checked, setChecked] = useState(true);
  const [text, setText] = useState("");
  const [pressed, setPressed] = useState(false);
  const [voiceState, setVoiceState] = useState<"recording" | "transcribing">(
    "recording",
  );
  const voice = useMemo(
    (): VoiceBarController => ({
      state: voiceState,
      readLevel: syntheticVoiceLevel,
      stop: async () => setVoiceState("transcribing"),
      cancel: () => setVoiceState("recording"),
    }),
    [voiceState],
  );
  const sheet = useSheet();
  const scrollSheet = useSheet();
  const menu = useSheet();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        padding: 16,
        paddingBottom: insets.bottom + 32,
        gap: 24,
      }}
      keyboardDismissMode="on-drag"
    >
      <Section
        title={`Theme — ${theme.palette} / ${theme.mode} (pref ${theme.preference})`}
      >
        <View className="flex-row flex-wrap gap-2">
          {MODES.map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={theme.preference === mode ? "default" : "outline"}
              onPress={() => theme.setMode(mode)}
            >
              {mode}
            </Button>
          ))}
        </View>
        <Text variant="caption">
          Palettes come from the server ({BUILTIN_THEME_IDS.join(", ")}); the
          integrator passes `palette` to UiProvider.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {(
            [
              "background",
              "foreground",
              "primary",
              "secondary",
              "muted",
              "accent",
              "destructive",
              "attention",
              "warning",
              "success",
              "sidebar",
              "border",
            ] as const
          ).map((key) => (
            <View key={key} className="items-center gap-1">
              <View
                className="h-8 w-8 rounded-md border border-border"
                style={{ backgroundColor: theme.tokens[key] }}
              />
              <Text variant="chrome">{key}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title="Text">
        <Text variant="title">Title — Inter SemiBold 18</Text>
        <Text variant="heading">Heading — 16 semibold</Text>
        <Text variant="label">Label — 15 medium</Text>
        <Text variant="body">
          Body — 15 regular. The quick brown fox jumps over the lazy dog.
        </Text>
        <Text variant="bodyLarge">Body large — 16 regular.</Text>
        <Text variant="caption">Caption — 14 muted</Text>
        <Text variant="chrome">CHROME — 11 muted</Text>
        <Text variant="mono">mono — const x = fn(a) =&gt; 0x1F;</Text>
        <Text className="text-sm font-semibold text-destructive-text">
          className-driven: font-semibold text-destructive-text
        </Text>
        <View className="flex-row gap-3">
          <Text tone="muted">muted</Text>
          <Text tone="subtle">subtle</Text>
          <Text tone="readback">readback</Text>
          <Text tone="primary">primary</Text>
          <Text tone="warning">warning</Text>
          <Text tone="success">success</Text>
        </View>
      </Section>

      <Section title="Button">
        <View className="flex-row flex-wrap gap-2">
          <Button
            onPress={() =>
              toast.success("Saved", { description: "Default button" })
            }
          >
            Default
          </Button>
          <Button
            variant="secondary"
            icon="Plus"
            onPress={() => toast.info("Secondary")}
          >
            Secondary
          </Button>
          <Button
            variant="outline"
            icon="Copy"
            onPress={() => toast.message("Outline")}
          >
            Outline
          </Button>
          <Button
            variant="ghost"
            onPress={() => toast.warning("Ghost pressed")}
          >
            Ghost
          </Button>
          <Button
            variant="destructive"
            icon="Trash2"
            onPress={() => toast.error("Deleted")}
          >
            Destructive
          </Button>
          <Button variant="link" onPress={() => undefined}>
            Link
          </Button>
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" icon="Settings" accessibilityLabel="Settings" />
          <Button
            size="icon"
            variant="ghost"
            icon="MoreHorizontal"
            accessibilityLabel="More"
          />
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button
            variant="ghost"
            icon="Pin"
            pressed={pressed}
            haptic
            onPress={() => setPressed((value) => !value)}
          >
            {pressed ? "Pinned" : "Pin"}
          </Button>
        </View>
      </Section>

      <Section title="Badge + Pill">
        <View className="flex-row flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="outline">Outline</Badge>
        </View>
        <View className="flex-row flex-wrap gap-2">
          <Pill variant="secondary">secondary</Pill>
          <Pill variant="outline">outline</Pill>
          <Pill variant="emphasis">emphasis</Pill>
          <Pill variant="destructive">destructive</Pill>
          <Pill variant="secondary" size="sm">
            sm
          </Pill>
        </View>
      </Section>

      <Section title="Input + TextArea + Switch">
        <Input
          placeholder="Server URL"
          value={text}
          onChangeText={setText}
          mono
          keyboardType="url"
        />
        <Input placeholder="Invalid" invalid />
        <Input placeholder="Disabled" editable={false} />
        <TextArea placeholder="Prompt…" />
        <View className="flex-row items-center justify-between">
          <Text variant="label">Notifications</Text>
          <Switch checked={checked} onCheckedChange={setChecked} />
        </View>
        <View className="flex-row items-center justify-between">
          <Text variant="label">Small switch</Text>
          <Switch size="sm" checked={checked} onCheckedChange={setChecked} />
        </View>
      </Section>

      <Section title="ListRow + Separator">
        <View className="overflow-hidden rounded-lg border border-border">
          <ListRow
            leading="Folder"
            title="bb"
            subtitle="~/code/bb · main"
            trailing="chevron"
            onPress={() => toast.message("Row pressed")}
            onLongPress={menu.present}
          />
          <Separator inset={52} />
          <ListRow
            leading="MessageSquare"
            title="A very long thread title that should truncate at one line no matter what"
            subtitle="2 minutes ago"
            trailing={
              <Pill variant="secondary" size="sm">
                running
              </Pill>
            }
            selected
            onPress={() => undefined}
          />
          <Separator inset={52} />
          <ListRow
            leading="Trash2"
            title="Delete thread"
            destructive
            onPress={menu.present}
          />
          <Separator inset={52} />
          <ListRow
            leading="Lock"
            title="Disabled row"
            disabled
            onPress={() => undefined}
          />
        </View>
        <Text variant="caption">
          Long-press the first row for an ActionSheet.
        </Text>
      </Section>

      <Section title="Voice bar (synthetic levels)">
        <View
          className="rounded-2xl border border-border bg-card"
          testID="dev-ui-voice-bar"
        >
          <VoiceBar voice={voice} />
        </View>
        <Text variant="caption">
          Check → transcribing (frozen, breathing); X → back to recording.
        </Text>
      </Section>

      <Section title="Skeleton + Spinner + EmptyState">
        <View className="gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-10 w-full" />
        </View>
        <View className="flex-row items-center gap-3">
          <Spinner />
          <Spinner size="large" />
          <Text variant="caption">Spinner</Text>
        </View>
        <EmptyState icon="Archive" message="No archived threads." />
        <EmptyStatePanel>Nothing here yet.</EmptyStatePanel>
      </Section>

      <Section title="Sheets">
        <View className="flex-row flex-wrap gap-2">
          <Button variant="outline" onPress={sheet.present}>
            Sheet
          </Button>
          <Button variant="outline" onPress={scrollSheet.present}>
            Scroll sheet
          </Button>
          <Button variant="outline" onPress={menu.present}>
            ActionSheet
          </Button>
        </View>
      </Section>

      <Section title={`Icons (${ICON_NAMES.length})`}>
        <View className="flex-row flex-wrap gap-3">
          {ICON_NAMES.map((name) => (
            <View key={name} className="w-16 items-center gap-1">
              <Icon name={name} />
              <Text variant="chrome" numberOfLines={1}>
                {name}
              </Text>
            </View>
          ))}
        </View>
      </Section>

      <Sheet controller={sheet} title="Sheet title">
        <View className="gap-3 p-4">
          <Text>Content realized two frames after presenting.</Text>
          <Input placeholder="Type here (keyboard-aware)" />
          <Button onPress={sheet.dismiss}>Done</Button>
        </View>
      </Sheet>

      <Sheet
        controller={scrollSheet}
        title="Scroll sheet"
        layout="scroll"
        snapPoints={["50%", "90%"]}
      >
        <View className="gap-2 p-4">
          {Array.from({ length: 40 }, (_, index) => (
            <Text key={index}>Row {index + 1}</Text>
          ))}
        </View>
      </Sheet>

      <ActionSheet
        controller={menu}
        title="Thread"
        message="bb · main"
        actions={[
          {
            key: "open",
            label: "Open",
            icon: "ArrowUpRight",
            onPress: () => toast.message("Open"),
          },
          {
            key: "pin",
            label: "Pin",
            icon: "Pin",
            onPress: () => toast.message("Pin"),
          },
          {
            key: "rename",
            label: "Rename",
            icon: "Edit",
            onPress: () => toast.message("Rename"),
          },
          {
            key: "archive",
            label: "Archive",
            icon: "Archive",
            onPress: () => toast.message("Archive"),
          },
          {
            key: "delete",
            label: "Delete",
            icon: "Trash2",
            destructive: true,
            onPress: () => toast.error("Deleted"),
          },
        ]}
      />
    </ScrollView>
  );
}

// Dev-only route: inert in production bundles (see app/e2e/reset.tsx).
export default function UiGalleryRoute() {
  if (!e2eModeEnabled) return <Redirect href="/" />;
  return <UiGalleryScreen />;
}

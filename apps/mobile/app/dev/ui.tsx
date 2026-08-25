// Dev-only gallery: renders every primitive in src/ui so the design system
// can be eyeballed per palette × mode on the simulator. Not product UI.
import { BUILTIN_THEME_IDS } from "@bb/domain";
import { Redirect } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { e2eModeEnabled } from "@/app-shell";
import { VoiceBar, type VoiceBarController } from "@/composer";
import { useTheme } from "@/theme/ThemeProvider";
import type { ThemeModePreference } from "@/theme/theme-preference";
import {
  ActionSheet,
  Badge,
  Button,
  confirmDestructive,
  EmptyState,
  EmptyStatePanel,
  GroupedRow,
  GroupedSection,
  ICON_NAMES,
  Icon,
  IconBadge,
  Input,
  ListRow,
  NativeMenu,
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
  type ActionSheetAction,
  type NativeMenuAction,
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
  const { tokens } = theme;
  const [checked, setChecked] = useState(true);
  const [text, setText] = useState("");
  const [pressed, setPressed] = useState(false);
  const [sort, setSort] = useState<"recent" | "name">("recent");
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
  const sortSheet = useSheet();

  const menuActions: NativeMenuAction[] = [
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
      onPress: () =>
        confirmDestructive({
          title: "Delete thread?",
          message: "This cannot be undone.",
          actionLabel: "Delete",
          onConfirm: () => toast.error("Deleted"),
        }),
    },
  ];
  const sortActions: ActionSheetAction[] = [
    {
      key: "recent",
      label: "Recent",
      icon: "Clock",
      checked: sort === "recent",
      onPress: () => setSort("recent"),
    },
    {
      key: "name",
      label: "Name",
      icon: "Sort",
      checked: sort === "name",
      onPress: () => setSort("name"),
    },
  ];

  return (
    <ScrollView
      className="flex-1 bg-surface-grouped"
      contentInsetAdjustmentBehavior="automatic"
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
              "surfaceGrouped",
              "surfaceGroupedCell",
            ] as const
          ).map((key) => (
            <View key={key} className="items-center gap-1">
              <View
                className="h-8 w-8 rounded-md border border-border"
                style={{ backgroundColor: tokens[key] }}
              />
              <Text variant="chrome">{key}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title="Text (Apple ramp)">
        <Text variant="largeTitle">Large title — 34 bold</Text>
        <Text variant="title">Title — 22 bold</Text>
        <Text variant="heading">Heading — 17 semibold</Text>
        <Text variant="headline">Headline — 17 semibold</Text>
        <Text variant="bodyLarge">
          Body large — 17 regular. The quick brown fox jumps over the lazy dog.
        </Text>
        <Text variant="body">
          Body — 15 regular (subheadline). The quick brown fox jumps over the
          lazy dog.
        </Text>
        <Text variant="label">Label — 15 medium</Text>
        <Text variant="caption">Caption — 13 muted (footnote)</Text>
        <Text variant="footnote">Footnote — 13 foreground</Text>
        <Text variant="sectionLabel">Section label — grouped header</Text>
        <Text variant="chrome">Chrome — 11 muted (caption2)</Text>
        <Text variant="mono">mono — const x = fn(a) =&gt; 0x1F;</Text>
        <View className="flex-row gap-4">
          <Text variant="bodyLarge" numeric>
            1111 / 0000 (tabular)
          </Text>
          <Text variant="bodyLarge">1111 / 0000 (proportional)</Text>
        </View>
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
              toast.success("Saved", { description: "Default → filled" })
            }
          >
            Default
          </Button>
          <Button
            variant="secondary"
            icon="Plus"
            onPress={() => toast.info("Secondary → tinted")}
          >
            Secondary
          </Button>
          <Button
            variant="outline"
            icon="Copy"
            onPress={() => toast.message("Outline → tinted")}
          >
            Outline
          </Button>
          <Button
            variant="ghost"
            onPress={() => toast.warning("Ghost → plain")}
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
          <Text variant="label">Small switch (Android only)</Text>
          <Switch size="sm" checked={checked} onCheckedChange={setChecked} />
        </View>
      </Section>

      <Section title="Grouped (iOS inset list)">
        <GroupedSection
          title="Settings"
          footer="Rows with badges, values, a switch, a check mark and a destructive action. Separators inset to the text column."
        >
          <GroupedRow
            title="General"
            badge={{ icon: "Settings", color: tokens.subtleForeground }}
            trailing="chevron"
            onPress={() => toast.message("General")}
          />
          <GroupedRow
            title="Appearance"
            badge={{ icon: "Palette", color: tokens.primary }}
            value={theme.mode}
            trailing="chevron"
            onPress={() => toast.message("Appearance")}
          />
          <GroupedRow
            title="Machines"
            badge={{ icon: "Laptop", color: tokens.success }}
            value="3"
            trailing="chevron"
            onPress={() => toast.message("Machines")}
          />
          <GroupedRow
            title="Haptics"
            subtitle="Vibrate on sends, toggles and warnings."
            trailing={<Switch checked={checked} onCheckedChange={setChecked} />}
          />
        </GroupedSection>
        <GroupedSection title="Sort by">
          <GroupedRow
            title="Recent"
            leading="Clock"
            trailing={sort === "recent" ? "checkmark" : null}
            onPress={() => setSort("recent")}
          />
          <GroupedRow
            title="Name"
            leading="Sort"
            trailing={sort === "name" ? "checkmark" : null}
            onPress={() => setSort("name")}
          />
        </GroupedSection>
        <GroupedSection>
          <GroupedRow
            title="Server"
            value="https://bb.example.com"
            selectable
          />
          <GroupedRow
            title="Remove machine"
            destructive
            onPress={() =>
              confirmDestructive({
                title: "Remove this machine?",
                message: "Threads on it stay on the server.",
                actionLabel: "Remove",
                onConfirm: () => toast.error("Removed"),
              })
            }
          />
        </GroupedSection>
        <Input placeholder="Grouped field (cell fill)" grouped />
        <View className="flex-row gap-3">
          <IconBadge icon="Puzzle" color={tokens.success} />
          <IconBadge icon="Zap" color={tokens.warning} />
          <IconBadge icon="Beaker" color={tokens.destructive} />
          <IconBadge icon="Github" color={tokens.foreground} />
        </View>
      </Section>

      <Section title="NativeMenu + confirmDestructive">
        <View className="flex-row flex-wrap items-center gap-2">
          {/* The one shape a native menu may wrap: an icon-only trigger
              named by `accessibilityLabel` (the host is the single element
              VoiceOver / Maestro see; it hides whatever it wraps). */}
          <NativeMenu
            title="Thread"
            actions={menuActions}
            accessibilityLabel="Thread actions"
            testID="dev-ui-thread-menu"
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-secondary">
              <Icon
                name="MoreHorizontal"
                symbol="ellipsis.circle"
                size={20}
                color={tokens.primary}
              />
            </View>
          </NativeMenu>
          {/* Text-bearing triggers present a sheet on both platforms. */}
          <Button variant="ghost" icon="Sort" onPress={sortSheet.present}>
            {sort === "recent" ? "Recent" : "Name"}
          </Button>
          <Button
            variant="destructive"
            onPress={() =>
              confirmDestructive({
                title: "Delete everything?",
                actionLabel: "Delete",
                onConfirm: () => toast.error("Gone"),
              })
            }
          >
            Confirm
          </Button>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Long-press me for the action sheet"
          onLongPress={menu.present}
          className="self-start rounded-2xl bg-secondary px-4 py-2 active:bg-state-active"
          style={{ borderCurve: "continuous" }}
        >
          <Text variant="bodyLarge">Long-press me for the action sheet</Text>
        </Pressable>
        <Text variant="caption">
          A native menu (iOS: UIMenu; Android: the ActionSheet fallback) wraps
          only an icon-only trigger — the iOS host drops what it wraps from the
          accessibility tree. Anything that shows text is a Pressable that
          presents an ActionSheet / OptionSheet on both platforms.
        </Text>
      </Section>

      <Section title="ListRow + Separator">
        <View
          className="overflow-hidden bg-surface-grouped-cell"
          style={{ borderRadius: 10, borderCurve: "continuous" }}
        >
          <ListRow
            leading="Folder"
            title="bb"
            subtitle="~/code/bb · main"
            trailing="chevron"
            onPress={() => toast.message("Row pressed")}
            onLongPress={menu.present}
          />
          <Separator inset={48} />
          <ListRow
            leading="MessageSquare"
            title="A very long thread title that should truncate at one line no matter what"
            subtitle="2 minutes ago"
            trailing={
              <Pill variant="secondary" size="sm">
                running
              </Pill>
            }
            onPress={() => undefined}
          />
          <Separator inset={48} />
          <ListRow
            leading="Check"
            leadingTone="primary"
            title="Selected row (check mark)"
            selected
            onPress={() => undefined}
          />
          <Separator inset={48} />
          <ListRow
            leading="Trash2"
            title="Delete thread"
            destructive
            onPress={menu.present}
          />
          <Separator inset={48} />
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

      <Section title="Sheets + Toasts">
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
        <View className="flex-row flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onPress={() => toast.success("Saved")}
          >
            success
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => toast.error("Failed")}
          >
            error
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => toast.warning("Careful")}
          >
            warning
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() =>
              toast.info("Heads up", {
                description: "With a description and an action.",
                action: { label: "Undo", onClick: () => undefined },
              })
            }
          >
            info
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
        actions={menuActions}
      />
      <ActionSheet
        controller={sortSheet}
        title="Sort by"
        actions={sortActions}
      />
    </ScrollView>
  );
}

// Dev-only route: inert in production bundles (see app/e2e/reset.tsx).
export default function UiGalleryRoute() {
  if (!e2eModeEnabled) return <Redirect href="/" />;
  return <UiGalleryScreen />;
}

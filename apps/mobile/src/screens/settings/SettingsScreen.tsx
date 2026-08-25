import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Linking } from "react-native";
import { e2eModeEnabled, resetLocalState, useProfiles } from "@/app-shell";
import { useTheme } from "@/theme";
import { confirmDestructive, GroupedRow, Icon, toast } from "@/ui";
import {
  archivedThreadsHref,
  machinesHref,
  marketplacesHref,
  pluginsHref,
  serverStatusHref,
  settingsSectionHref,
  skillsHref,
} from "../shell/hrefs";
import { GroupedScreen } from "./GroupedScreen";
import { HapticsSettingsRow } from "./HapticsSettingsRow";
import { useBadgeColors } from "./settings-badges";
import { BADGE_ROW_SEPARATOR_INSET, SettingsSection } from "./SettingsRows";

const DISCORD_INVITE_URL = "https://discord.gg/kvBU6tJhcJ";
const GITHUB_REPO_URL = "https://github.com/get-bb/bb";

function openExternal(url: string): void {
  Linking.openURL(url).catch(() => {
    toast.error("Could not open the link");
  });
}

/**
 * Settings home, laid out like the iOS Settings app: inset-grouped rows
 * with tinted icon badges, the current value on the right and a chevron
 * into each bucket (the web settings-nav.tsx buckets minus the
 * desktop-only ones). Server / Machines / Developer / About are
 * mobile-specific.
 */
export function SettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const colors = useBadgeColors();
  const { profiles, activeProfile } = useProfiles();
  const appVersion = Constants.expoConfig?.version ?? "dev";
  const connected = activeProfile !== null;
  const modeLabel =
    theme.preference === "system"
      ? "System"
      : theme.preference === "dark"
        ? "Dark"
        : "Light";
  const externalLinkGlyph = (
    <Icon
      name="ExternalLink"
      size={16}
      weight="semibold"
      color={theme.tokens.subtleForeground}
    />
  );

  const resetLocal = () =>
    confirmDestructive({
      title: "Reset local state?",
      message:
        "Saved servers and preferences are removed. The app returns to first run.",
      actionLabel: "Reset",
      onConfirm: () => {
        resetLocalState()
          .then(() => {
            toast.success("Local state reset");
            router.dismissTo("/");
          })
          .catch((error: unknown) => {
            toast.error("Reset failed", { description: String(error) });
          });
      },
    });

  return (
    <GroupedScreen testID="settings-screen">
      <SettingsSection title="Server">
        <GroupedRow
          title="Servers"
          value={
            activeProfile
              ? profiles.length > 1
                ? `${activeProfile.label} · ${profiles.length}`
                : activeProfile.label
              : "None"
          }
          badge={{ icon: "Cloud", symbol: "server.rack", color: colors.blue }}
          trailing="chevron"
          onPress={() => router.push("/settings/servers")}
          testID="settings-servers"
        />
        <GroupedRow
          title="Server status"
          badge={{
            icon: "Info",
            symbol: "info.circle.fill",
            color: colors.gray,
          }}
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(serverStatusHref())}
          testID="settings-server-status"
        />
      </SettingsSection>

      <SettingsSection
        title="Preferences"
        separatorInset={BADGE_ROW_SEPARATOR_INSET}
        footnote="Haptics play on pickers, send, approvals, and destructive actions."
      >
        <GroupedRow
          title="General"
          badge={{
            icon: "Settings",
            symbol: "gearshape.fill",
            color: colors.gray,
          }}
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(settingsSectionHref("general"))}
          testID="settings-general"
        />
        <GroupedRow
          title="Appearance"
          value={modeLabel}
          badge={{
            icon: "Palette",
            symbol: "paintpalette.fill",
            color: colors.purple,
          }}
          trailing="chevron"
          onPress={() => router.push(settingsSectionHref("appearance"))}
          testID="settings-appearance"
        />
        <GroupedRow
          title="Experiments"
          badge={{ icon: "Beaker", symbol: "testtube.2", color: colors.orange }}
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(settingsSectionHref("experiments"))}
          testID="settings-experiments"
        />
        <HapticsSettingsRow />
      </SettingsSection>

      <SettingsSection title="Agents">
        <GroupedRow
          title="Provider settings"
          badge={{ icon: "Brain", symbol: "brain", color: colors.indigo }}
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(pluginsHref())}
          testID="settings-provider-plugins"
        />
        <GroupedRow
          title="Usage limits"
          badge={{
            icon: "ChartColumn",
            symbol: "chart.bar.fill",
            color: colors.orange,
          }}
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(settingsSectionHref("usage"))}
          testID="settings-usage"
        />
        <GroupedRow
          title="Machines"
          badge={{
            icon: "Laptop",
            symbol: "laptopcomputer",
            color: colors.blue,
          }}
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(machinesHref())}
          testID="settings-machines"
        />
        <GroupedRow
          title="Updates"
          badge={{
            icon: "Download",
            symbol: "arrow.down.circle.fill",
            color: colors.green,
          }}
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(settingsSectionHref("updates"))}
          testID="settings-updates"
        />
      </SettingsSection>

      <SettingsSection title="Extensions">
        <GroupedRow
          title="Plugins"
          badge={{
            icon: "Puzzle",
            symbol: "puzzlepiece.extension.fill",
            color: colors.green,
          }}
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(pluginsHref())}
          testID="settings-plugins"
        />
        <GroupedRow
          title="Skills"
          badge={{
            icon: "AiContentGenerator01",
            symbol: "sparkles",
            color: colors.pink,
          }}
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(skillsHref())}
          testID="settings-skills"
        />
        <GroupedRow
          title="Plugin marketplaces"
          badge={{
            icon: "PackageReceive",
            symbol: "shippingbox.fill",
            color: colors.teal,
          }}
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(marketplacesHref())}
          testID="settings-marketplaces"
        />
      </SettingsSection>

      <SettingsSection title="Threads">
        <GroupedRow
          title="Archived threads"
          badge={{
            icon: "Archive",
            symbol: "archivebox.fill",
            color: colors.gray,
          }}
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(archivedThreadsHref())}
          testID="settings-archived"
        />
      </SettingsSection>

      <SettingsSection title="Community">
        <GroupedRow
          title="Discord"
          subtitle="Support, feedback, and announcements"
          badge={{ icon: "Discord", color: colors.discord }}
          trailing={externalLinkGlyph}
          onPress={() => openExternal(DISCORD_INVITE_URL)}
          testID="settings-discord"
        />
        <GroupedRow
          title="GitHub"
          subtitle="Source code, issues, and releases"
          badge={{ icon: "Github", color: colors.github }}
          trailing={externalLinkGlyph}
          onPress={() => openExternal(GITHUB_REPO_URL)}
          testID="settings-github"
        />
      </SettingsSection>

      {e2eModeEnabled ? (
        <SettingsSection
          title="Developer"
          footnote="Showcases for every primitive and renderer; only in development and E2E builds."
        >
          <GroupedRow
            title="UI gallery"
            badge={{
              icon: "Palette",
              symbol: "paintpalette.fill",
              color: colors.gray,
            }}
            trailing="chevron"
            onPress={() => router.push("/dev/ui")}
            testID="settings-dev-ui"
          />
          <GroupedRow
            title="Diff + terminal showcase"
            badge={{
              icon: "FileDiff",
              symbol: "plus.forwardslash.minus",
              color: colors.gray,
            }}
            trailing="chevron"
            onPress={() => router.push("/dev/diff")}
            testID="settings-dev-diff"
          />
          <GroupedRow
            title="Work rows showcase"
            badge={{
              icon: "Terminal",
              symbol: "terminal.fill",
              color: colors.gray,
            }}
            trailing="chevron"
            onPress={() => router.push("/dev/work-rows")}
            testID="settings-dev-work-rows"
          />
          <GroupedRow
            title="Interactions showcase"
            badge={{
              icon: "MessageQuestion",
              symbol: "questionmark.bubble.fill",
              color: colors.gray,
            }}
            trailing="chevron"
            onPress={() => router.push("/dev/interactions")}
            testID="settings-dev-interactions"
          />
          <GroupedRow
            title="Composer showcase"
            badge={{
              icon: "MessageSquarePlus",
              symbol: "plus.bubble.fill",
              color: colors.gray,
            }}
            trailing="chevron"
            onPress={() => router.push("/dev/composer")}
            testID="settings-dev-composer"
          />
          <GroupedRow
            title="Markdown showcase"
            badge={{
              icon: "FileText",
              symbol: "doc.text.fill",
              color: colors.gray,
            }}
            trailing="chevron"
            onPress={() => router.push("/dev/markdown")}
            testID="settings-dev-markdown"
          />
          <GroupedRow
            title="Runtime spike"
            badge={{ icon: "Beaker", symbol: "testtube.2", color: colors.gray }}
            trailing="chevron"
            onPress={() => router.push("/dev/spike")}
            testID="settings-dev-spike"
          />
          <GroupedRow
            title="Connect cookie spike"
            badge={{ icon: "Globe", symbol: "globe", color: colors.gray }}
            trailing="chevron"
            onPress={() => router.push("/dev/connect-spike")}
            testID="settings-dev-connect-spike"
          />
          <GroupedRow
            title="Reset local state"
            badge={{ icon: "Trash2", symbol: "trash.fill", color: colors.red }}
            destructive
            onPress={resetLocal}
            testID="settings-dev-reset"
          />
        </SettingsSection>
      ) : null}

      <SettingsSection title="About">
        <GroupedRow
          title="bb mobile"
          value={`Version ${appVersion}`}
          badge={{ icon: "Smartphone", symbol: "iphone", color: colors.gray }}
          selectable
        />
      </SettingsSection>
    </GroupedScreen>
  );
}

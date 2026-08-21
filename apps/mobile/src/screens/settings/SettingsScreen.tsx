import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Linking } from "react-native";
import { e2eModeEnabled, resetLocalState, useProfiles } from "@/app-shell";
import { useTheme } from "@/theme";
import { ActionSheet, Icon, ListRow, toast, useSheet } from "@/ui";
import {
  archivedThreadsHref,
  machinesHref,
  marketplacesHref,
  pluginsHref,
  serverStatusHref,
  settingsSectionHref,
  skillsHref,
} from "../shell/hrefs";
import { Screen } from "../shell/Screen";
import { HapticsSettingsRow } from "./HapticsSettingsRow";
import { SettingsSection } from "./SettingsRows";

const DISCORD_INVITE_URL = "https://discord.gg/kvBU6tJhcJ";
const GITHUB_REPO_URL = "https://github.com/get-bb/bb";

function openExternal(url: string): void {
  Linking.openURL(url).catch(() => {
    toast.error("Could not open the link");
  });
}

/**
 * Settings home: the web settings buckets (settings-nav.tsx) minus the
 * desktop-only ones (Keyboard, Files), each a row into its own screen.
 * Server / Notifications / Developer / About are mobile-specific.
 */
export function SettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { profiles, activeProfile } = useProfiles();
  const resetSheet = useSheet();
  const appVersion = Constants.expoConfig?.version ?? "dev";
  const connected = activeProfile !== null;
  const externalLinkGlyph = (
    <Icon name="ExternalLink" size={18} color={theme.tokens.subtleForeground} />
  );

  return (
    <Screen testID="settings-screen">
      <SettingsSection title="Server">
        <ListRow
          title="Servers"
          subtitle={
            activeProfile
              ? `${activeProfile.label} · ${profiles.length} saved`
              : "No servers saved"
          }
          leading="Laptop"
          trailing="chevron"
          onPress={() => router.push("/settings/servers")}
          testID="settings-servers"
        />
        <ListRow
          title="Server status"
          subtitle="Connection, primary host, version"
          leading="Info"
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(serverStatusHref())}
          testID="settings-server-status"
        />
      </SettingsSection>

      <SettingsSection title="Preferences">
        <ListRow
          title="General"
          subtitle="Threads, links, debug"
          leading="Settings"
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(settingsSectionHref("general"))}
          testID="settings-general"
        />
        <ListRow
          title="Appearance"
          subtitle={`${theme.preference === "system" ? "System" : theme.preference === "dark" ? "Dark" : "Light"} · ${theme.palette} palette`}
          leading="Palette"
          trailing="chevron"
          onPress={() => router.push(settingsSectionHref("appearance"))}
          testID="settings-appearance"
        />
        <ListRow
          title="Experiments"
          subtitle="Early features, off by default"
          leading="Beaker"
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(settingsSectionHref("experiments"))}
          testID="settings-experiments"
        />
        <HapticsSettingsRow />
      </SettingsSection>

      <SettingsSection title="Providers">
        <ListRow
          title="Provider settings"
          subtitle="Each provider's options live on its plugin"
          leading="Brain"
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(pluginsHref())}
          testID="settings-provider-plugins"
        />
        <ListRow
          title="Usage limits"
          subtitle="Provider subscription usage per machine"
          leading="ChartColumn"
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(settingsSectionHref("usage"))}
          testID="settings-usage"
        />
      </SettingsSection>

      <SettingsSection title="Machines and updates">
        <ListRow
          title="Machines"
          subtitle="Paired computers, permission limits, pairing"
          leading="Laptop"
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(machinesHref())}
          testID="settings-machines"
        />
        <ListRow
          title="Updates"
          subtitle="bb, provider CLIs, CLI skills"
          leading="PackageReceive"
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(settingsSectionHref("updates"))}
          testID="settings-updates"
        />
      </SettingsSection>

      <SettingsSection title="Extensions">
        <ListRow
          title="Plugins"
          subtitle="Installed plugins and their settings"
          leading="Puzzle"
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(pluginsHref())}
          testID="settings-plugins"
        />
        <ListRow
          title="Skills"
          subtitle="Library and registry"
          leading="Toolbox"
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(skillsHref())}
          testID="settings-skills"
        />
        <ListRow
          title="Plugin marketplaces"
          subtitle="Where plugins are installed from"
          leading="Globe"
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(marketplacesHref())}
          testID="settings-marketplaces"
        />
      </SettingsSection>

      <SettingsSection title="Threads">
        <ListRow
          title="Archived threads"
          subtitle="Browse and unarchive"
          leading="Archive"
          trailing="chevron"
          disabled={!connected}
          onPress={() => router.push(archivedThreadsHref())}
          testID="settings-archived"
        />
      </SettingsSection>

      <SettingsSection title="Community">
        <ListRow
          title="Discord"
          subtitle="Support, feedback, and announcements"
          leading="Discord"
          trailing={externalLinkGlyph}
          onPress={() => openExternal(DISCORD_INVITE_URL)}
          testID="settings-discord"
        />
        <ListRow
          title="GitHub"
          subtitle="Source code, issues, and releases"
          leading="Github"
          trailing={externalLinkGlyph}
          onPress={() => openExternal(GITHUB_REPO_URL)}
          testID="settings-github"
        />
      </SettingsSection>

      {e2eModeEnabled ? (
        <SettingsSection title="Developer">
          <ListRow
            title="UI gallery"
            subtitle="Every primitive, palette × mode"
            leading="Palette"
            trailing="chevron"
            onPress={() => router.push("/dev/ui")}
            testID="settings-dev-ui"
          />
          <ListRow
            title="Diff + terminal showcase"
            subtitle="Native diff cards and ANSI output fixtures"
            leading="FileDiff"
            trailing="chevron"
            onPress={() => router.push("/dev/diff")}
            testID="settings-dev-diff"
          />
          <ListRow
            title="Work rows showcase"
            subtitle="Timeline work-row renderers on synthetic rows"
            leading="Terminal"
            trailing="chevron"
            onPress={() => router.push("/dev/work-rows")}
            testID="settings-dev-work-rows"
          />
          <ListRow
            title="Interactions showcase"
            subtitle="Pending-interaction banners and the queued messages list"
            leading="MessageQuestion"
            trailing="chevron"
            onPress={() => router.push("/dev/interactions")}
            testID="settings-dev-interactions"
          />
          <ListRow
            title="Composer showcase"
            subtitle="Mentions, slash commands, attachments, voice"
            leading="MessageSquarePlus"
            trailing="chevron"
            onPress={() => router.push("/dev/composer")}
            testID="settings-dev-composer"
          />
          <ListRow
            title="Markdown showcase"
            subtitle="Every markdown node type, mentions, directives"
            leading="FileText"
            trailing="chevron"
            onPress={() => router.push("/dev/markdown")}
            testID="settings-dev-markdown"
          />
          <ListRow
            title="Runtime spike"
            subtitle="Phase 0 diagnostics: SDK, realtime, polyfills"
            leading="Beaker"
            trailing="chevron"
            onPress={() => router.push("/dev/spike")}
            testID="settings-dev-spike"
          />
          <ListRow
            title="Connect cookie spike"
            subtitle="Machine code → session cookie → fetch/WS/WebView"
            leading="Globe"
            trailing="chevron"
            onPress={() => router.push("/dev/connect-spike")}
            testID="settings-dev-connect-spike"
          />
          <ListRow
            title="Reset local state"
            subtitle="Remove every saved server and preference"
            leading="Trash2"
            destructive
            onPress={resetSheet.present}
            testID="settings-dev-reset"
          />
        </SettingsSection>
      ) : null}

      <SettingsSection title="About">
        <ListRow
          title="bb mobile"
          subtitle={`Version ${appVersion}`}
          leading="Smartphone"
        />
      </SettingsSection>

      <ActionSheet
        controller={resetSheet}
        title="Reset local state?"
        message="Saved servers and preferences are removed. The app returns to first run."
        actions={[
          {
            key: "reset",
            label: "Reset",
            icon: "Trash2",
            destructive: true,
            onPress: () => {
              resetLocalState()
                .then(() => {
                  toast.success("Local state reset");
                  router.dismissTo("/");
                })
                .catch((error: unknown) => {
                  toast.error("Reset failed", { description: String(error) });
                });
            },
          },
        ]}
      />
    </Screen>
  );
}

import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { useProfiles } from "@/app-shell";
import { describeError } from "@/lib/describe-error";
import { haptic } from "@/lib/haptics";
import type { ServerProfile } from "@/lib/profiles";
import {
  ActionSheet,
  confirmDestructive,
  GroupedRow,
  Icon,
  toast,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
import { connectEnrollHref } from "../shell/hrefs";
import { GroupedScreen } from "./GroupedScreen";
import {
  HeaderIconButton,
  ICON_ROW_SEPARATOR_INSET,
  SettingsSection,
} from "./SettingsRows";

const IS_IOS = process.env.EXPO_OS === "ios";

export function ServersScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { profiles, activeProfile, setActiveProfile, removeProfile } =
    useProfiles();
  const menu = useSheet();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [target, setTarget] = useState<ServerProfile | null>(null);

  const addServer = () => router.push("/settings/servers/add");

  const activate = (profile: ServerProfile) => {
    if (profile.id === activeProfile?.id) return;
    setActiveProfile(profile.id).catch((error: unknown) => {
      toast.error("Could not switch server", {
        description: describeError(error),
      });
    });
  };

  const remove = (profile: ServerProfile) => {
    removeProfile(profile.id)
      .then(() => toast.success(`Removed ${profile.label}`))
      .catch((error: unknown) => {
        toast.error("Could not remove server", {
          description: describeError(error),
        });
      });
  };

  const confirmRemove = (profile: ServerProfile) =>
    confirmDestructive({
      title: `Remove ${profile.label}?`,
      message:
        profile.mode === "connect"
          ? "The app forgets this server and its device credential. The phone stays listed under Machines in the getbb.app dashboard until you revoke it there."
          : "The app forgets this server. Nothing on the server changes.",
      actionLabel: "Remove",
      onConfirm: () => remove(profile),
    });

  const actionsFor = (profile: ServerProfile): ActionSheetAction[] => [
    ...(IS_IOS || profile.id !== activeProfile?.id
      ? [
          {
            key: "activate",
            label: "Use this server",
            icon: "Check" as const,
            disabled: profile.id === activeProfile?.id,
            onPress: () => activate(profile),
          },
        ]
      : []),
    ...(profile.mode === "connect"
      ? [
          {
            key: "reauth",
            label: "Sign in again",
            icon: "Lock" as const,
            onPress: () => {
              router.push(connectEnrollHref({ profileId: profile.id }));
            },
          },
        ]
      : []),
    {
      key: "remove",
      label: "Remove",
      icon: "Trash2",
      destructive: true,
      dismissOnPress: IS_IOS,
      onPress: () => {
        if (IS_IOS) confirmRemove(profile);
        else setConfirmingRemoval(true);
      },
    },
  ];

  const openMenu = (profile: ServerProfile) => {
    haptic("impact-heavy");
    setTarget(profile);
    menu.present();
  };

  return (
    <>
      {IS_IOS ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="plus"
            accessibilityLabel="Add server"
            onPress={addServer}
          />
        </Stack.Toolbar>
      ) : (
        <Stack.Screen
          options={{
            headerRight: () => (
              <HeaderIconButton
                icon="Plus"
                accessibilityLabel="Add server"
                onPress={addServer}
                testID="servers-add"
              />
            ),
          }}
        />
      )}
      <GroupedScreen testID="servers-screen">
        {profiles.length === 0 ? (
          <SettingsSection footnote="No servers saved yet. Pair through getbb.app or enter a direct URL.">
            <GroupedRow
              title="Add server"
              leading="Plus"
              leadingTone="primary"
              onPress={addServer}
            />
          </SettingsSection>
        ) : (
          <SettingsSection
            title="Saved servers"
            separatorInset={ICON_ROW_SEPARATOR_INSET}
            footnote={
              IS_IOS
                ? "Tap a server to make it active."
                : "Tap a server to make it active. Long-press for more."
            }
          >
            {profiles.map((profile) => (
              <GroupedRow
                key={profile.id}
                title={profile.label}
                subtitle={
                  IS_IOS
                    ? profile.mode === "connect"
                      ? `@${profile.handle} · ${profile.serverUrl}`
                      : profile.serverUrl
                    : profile.serverUrl
                        .replace(/^https?:\/\//, "")
                        .replace(/\/$/, "")
                }
                leading={profile.mode === "connect" ? "Globe" : "Laptop"}
                value={
                  IS_IOS
                    ? profile.mode === "connect"
                      ? "bb connect"
                      : "Direct"
                    : undefined
                }
                selected={profile.id === activeProfile?.id}
                accessibilityLabel={`${profile.label}, ${profile.mode === "connect" ? "bb connect" : "Direct"}, ${profile.serverUrl}`}
                trailing={
                  IS_IOS ? (
                    profile.id === activeProfile?.id ? (
                      "checkmark"
                    ) : undefined
                  ) : (
                    <View className="h-6 w-6 items-center justify-center">
                      {profile.id === activeProfile?.id ? (
                        <Icon
                          name="CircleCheckFilled"
                          size={20}
                          color={tokens.success}
                        />
                      ) : null}
                    </View>
                  )
                }
                onPress={() => activate(profile)}
                onLongPress={() => openMenu(profile)}
                testID={`server-row-${profile.id}`}
              />
            ))}
          </SettingsSection>
        )}
      </GroupedScreen>

      <ActionSheet
        controller={menu}
        cancelLabel={IS_IOS || confirmingRemoval ? "Cancel" : null}
        status={
          !IS_IOS && !confirmingRemoval && target?.id === activeProfile?.id
            ? "Current"
            : undefined
        }
        presentation={confirmingRemoval ? "prompt" : "menu"}
        title={confirmingRemoval ? `Remove ${target?.label}?` : target?.label}
        message={
          confirmingRemoval
            ? target?.mode === "connect"
              ? "This removes the server and its device credential from this phone. Revoke the phone separately in getbb.app → Machines."
              : "This removes the server from this phone. Nothing on the server changes."
            : target?.serverUrl
        }
        actions={
          target
            ? confirmingRemoval
              ? [
                  {
                    key: "confirm-remove",
                    label: "Remove server",
                    icon: "Trash2",
                    destructive: true,
                    onPress: () => remove(target),
                  },
                ]
              : actionsFor(target)
            : []
        }
        onDismiss={() => setConfirmingRemoval(false)}
      />
    </>
  );
}

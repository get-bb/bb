import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useProfiles } from "@/app-shell";
import { describeError } from "@/lib/describe-error";
import type { ServerProfile } from "@/lib/profiles";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  Button,
  EmptyStatePanel,
  Icon,
  ListRow,
  Pill,
  Text,
  toast,
  useSheet,
} from "@/ui";
import { connectEnrollHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";

/** Saved servers: tap to switch, long-press for actions, "+" to add. */
export function ServersScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { profiles, activeProfile, setActiveProfile, removeProfile } =
    useProfiles();
  const menu = useSheet();
  const confirmRemove = useSheet();
  const [target, setTarget] = useState<ServerProfile | null>(null);

  const openMenu = (profile: ServerProfile) => {
    setTarget(profile);
    menu.present();
  };

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

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add server"
              hitSlop={8}
              onPress={() => router.push("/settings/servers/add")}
              testID="servers-add"
            >
              <Icon name="Plus" size={22} color={tokens.foreground} />
            </Pressable>
          ),
        }}
      />
      <Screen testID="servers-screen">
        {profiles.length === 0 ? (
          <View className="gap-3">
            <EmptyStatePanel>No servers saved yet.</EmptyStatePanel>
            <Button
              icon="Plus"
              onPress={() => router.push("/settings/servers/add")}
            >
              Add server
            </Button>
          </View>
        ) : (
          <View className="overflow-hidden rounded-lg border border-border bg-card">
            {profiles.map((profile) => (
              <ListRow
                key={profile.id}
                title={profile.label}
                subtitle={
                  profile.mode === "connect"
                    ? `@${profile.handle} · ${profile.serverUrl}`
                    : profile.serverUrl
                }
                leading={profile.mode === "connect" ? "Globe" : "Laptop"}
                selected={profile.id === activeProfile?.id}
                trailing={
                  <View className="flex-row items-center gap-2">
                    <Pill
                      variant={
                        profile.mode === "connect" ? "emphasis" : "outline"
                      }
                      size="sm"
                    >
                      {profile.mode === "connect" ? "bb connect" : "direct"}
                    </Pill>
                    {profile.id === activeProfile?.id ? (
                      <Icon name="Check" size={18} color={tokens.foreground} />
                    ) : (
                      <Icon
                        name="MoreHorizontal"
                        size={18}
                        color={tokens.subtleForeground}
                      />
                    )}
                  </View>
                }
                onPress={() => activate(profile)}
                onLongPress={() => openMenu(profile)}
                testID={`server-row-${profile.id}`}
              />
            ))}
          </View>
        )}
        <Text variant="caption">
          Tap a server to make it active. Long-press for more.
        </Text>
      </Screen>

      <ActionSheet
        controller={menu}
        title={target?.label}
        message={target?.serverUrl}
        actions={[
          {
            key: "activate",
            label: "Use this server",
            icon: "Check",
            disabled: target?.id === activeProfile?.id,
            onPress: () => {
              if (target) activate(target);
            },
          },
          ...(target?.mode === "connect"
            ? [
                {
                  key: "reauth",
                  label: "Sign in again",
                  icon: "Lock" as const,
                  onPress: () => {
                    if (target) {
                      router.push(connectEnrollHref({ profileId: target.id }));
                    }
                  },
                },
              ]
            : []),
          {
            key: "remove",
            label: "Remove",
            icon: "Trash2",
            destructive: true,
            onPress: () => {
              // Present after the menu has started dismissing so the two
              // sheets do not fight over the modal host.
              setTimeout(() => confirmRemove.present(), 250);
            },
          },
        ]}
      />
      <ActionSheet
        controller={confirmRemove}
        title={target ? `Remove ${target.label}?` : "Remove server?"}
        message={
          target?.mode === "connect"
            ? "The app forgets this server and its device credential. The phone stays listed under Machines in the getbb.app dashboard until you revoke it there."
            : "The app forgets this server. Nothing on the server changes."
        }
        actions={[
          {
            key: "confirm",
            label: "Remove",
            icon: "Trash2",
            destructive: true,
            onPress: () => {
              if (target) remove(target);
            },
          },
        ]}
      />
    </>
  );
}

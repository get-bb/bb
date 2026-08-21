import type { ConnectCredential } from "@bb/connect-client";
import { useState } from "react";
import { View } from "react-native";
import { useProfiles } from "@/app-shell";
import { accountServerProfile, useAccountServers } from "@/data/connect";
import { describeError } from "@/lib/describe-error";
import { Button, ListRow, Pill, Spinner, Text, toast } from "@/ui";

/**
 * The other bb servers on the same getbb.app account, one tap to save each
 * as a profile. The machine credential just enrolled is account-scoped and
 * the gate's desktop-session cookie is a `.getbb.app` cookie, so no second
 * pairing code is needed (the desktop app's Server menu works the same way).
 */
export function AccountServersList({
  credential,
}: {
  credential: ConnectCredential;
}) {
  const { profiles, addProfile } = useProfiles();
  const { state, reload } = useAccountServers(credential);
  const [adding, setAdding] = useState<string | null>(null);

  const savedHandles = new Set(
    profiles.flatMap((profile) =>
      profile.mode === "connect"
        ? [`${profile.handle} ${profile.serverUrl}`]
        : [],
    ),
  );

  const add = async (server: { handle: string; name: string; url: string }) => {
    setAdding(server.handle);
    try {
      const profile = await addProfile(
        accountServerProfile(credential, server),
      );
      toast.success(`Added ${profile.label}`);
    } catch (error) {
      toast.error("Could not add server", {
        description: describeError(error),
      });
    } finally {
      setAdding(null);
    }
  };

  return (
    <View className="gap-2" testID="connect-account-servers">
      <Text variant="sectionLabel">Servers on this account</Text>
      {state.status === "loading" || state.status === "idle" ? (
        <View className="flex-row items-center gap-2 px-1 py-2">
          <Spinner />
          <Text variant="caption">Loading your servers…</Text>
        </View>
      ) : state.status === "error" ? (
        <View className="gap-2">
          <Text variant="caption" tone="destructive">
            {state.failure.title}: {state.failure.message}
          </Text>
          <Button variant="outline" size="sm" onPress={reload}>
            Try again
          </Button>
        </View>
      ) : state.servers.length === 0 ? (
        <Text variant="caption">
          No servers are paired with this account yet.
        </Text>
      ) : (
        <View className="overflow-hidden rounded-lg border border-border bg-card">
          {state.servers.map((server) => {
            const isSelf = server.handle === state.selfHandle;
            const saved = savedHandles.has(`${server.handle} ${server.url}`);
            return (
              <ListRow
                key={server.handle}
                title={server.name}
                subtitle={server.url}
                leading="Globe"
                trailing={
                  isSelf || saved ? (
                    <Pill variant="secondary">
                      {isSelf ? "This server" : "Saved"}
                    </Pill>
                  ) : (
                    <View className="flex-row items-center gap-2">
                      <Pill variant={server.live ? "outline" : "secondary"}>
                        {server.live ? "Online" : "Offline"}
                      </Pill>
                      <Button
                        size="sm"
                        variant="outline"
                        icon="Plus"
                        loading={adding === server.handle}
                        disabled={adding !== null}
                        onPress={() => void add(server)}
                        testID={`account-server-add-${server.handle}`}
                      >
                        Add
                      </Button>
                    </View>
                  )
                }
                testID={`account-server-${server.handle}`}
              />
            );
          })}
        </View>
      )}
      <Text variant="caption">
        One pairing covers every server on the account: the credential and the
        session cookie are account-wide. Servers paired later show up here too.
      </Text>
    </View>
  );
}

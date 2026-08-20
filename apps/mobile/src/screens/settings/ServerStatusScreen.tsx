import { useProfiles } from "@/app-shell";
import { EmptyStatePanel } from "@/ui";
import { ServerInfoCard } from "../home/ServerInfoCard";
import { Screen } from "../shell/Screen";

/** `/settings/server`: the active server's status card (URL, realtime, host, version). */
export function ServerStatusScreen() {
  const { connection } = useProfiles();
  return (
    <Screen testID="server-status-screen">
      {connection ? (
        <ServerInfoCard />
      ) : (
        <EmptyStatePanel>No active server.</EmptyStatePanel>
      )}
    </Screen>
  );
}

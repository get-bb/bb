import type { TerminalCreateScope } from "@bb/sdk/browser";
import { View } from "react-native";
import { useProfiles } from "@/app-shell/ProfilesProvider";
import {
  describeTerminalSessionRow,
  getTerminalSessions,
  sortTerminalSessions,
  useCreateTerminal,
  useTerminals,
} from "@/data/terminals";
import type { TerminalQueryScope } from "@/lib/query/query-keys";
import { Button, EmptyStatePanel, ListRow, Skeleton, Text } from "@/ui";

/**
 * The scope's terminal sessions with a "Start terminal" action: the body of
 * the panel's Terminal launcher and of `/threads/[id]/terminal`. Selecting a
 * session hands its id to the caller (a panel tab or the full-screen route).
 */

interface TerminalSessionsListProps {
  listScope: TerminalQueryScope;
  createScope: TerminalCreateScope;
  onOpenTerminal: (terminalId: string) => void;
  testID?: string;
}

export function TerminalSessionsList(props: TerminalSessionsListProps) {
  // Rendered inside the panel sheet's portal: it can outlive its screen.
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <View className="p-4" testID={props.testID ?? "terminal-sessions"}>
        <EmptyStatePanel>No active server.</EmptyStatePanel>
      </View>
    );
  }
  return <ConnectedTerminalSessionsList {...props} />;
}

function ConnectedTerminalSessionsList({
  listScope,
  createScope,
  onOpenTerminal,
  testID = "terminal-sessions",
}: TerminalSessionsListProps) {
  const terminalsQuery = useTerminals(listScope);
  const createTerminal = useCreateTerminal();
  const sessions = sortTerminalSessions(
    getTerminalSessions(terminalsQuery.data),
  );

  const startTerminal = () => {
    if (createTerminal.isPending) return;
    createTerminal.mutate(
      { scope: createScope },
      { onSuccess: (session) => onOpenTerminal(session.id) },
    );
  };

  return (
    <View className="gap-3 p-4" testID={testID}>
      <Button
        icon="Terminal"
        loading={createTerminal.isPending}
        onPress={startTerminal}
        testID="terminal-sessions-start"
      >
        Start terminal
      </Button>
      {terminalsQuery.isLoading && !terminalsQuery.data ? (
        <View className="gap-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </View>
      ) : terminalsQuery.error && !terminalsQuery.data ? (
        <EmptyStatePanel>
          <Text className="text-center text-sm text-destructive-text">
            Failed to load terminals.
          </Text>
          <Text variant="caption" className="pt-1 text-center">
            {terminalsQuery.error.message}
          </Text>
        </EmptyStatePanel>
      ) : sessions.length === 0 ? (
        <EmptyStatePanel>No terminals</EmptyStatePanel>
      ) : (
        <View className="overflow-hidden rounded-lg border border-border bg-card">
          {sessions.map((session, index) => {
            const row = describeTerminalSessionRow(session);
            return (
              <View key={session.id}>
                {index > 0 ? (
                  <View className="ml-4 h-px bg-border-hairline" />
                ) : null}
                <ListRow
                  leading="Terminal"
                  title={row.title}
                  subtitle={row.subtitle}
                  trailing="chevron"
                  disabled={!row.active}
                  onPress={() => onOpenTerminal(session.id)}
                  testID={`terminal-session-row-${session.id}`}
                />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

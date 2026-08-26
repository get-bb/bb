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
import {
  Button,
  GroupedRow,
  GroupedSection,
  Skeleton,
  Text,
  type GroupedSurface,
} from "@/ui";

/**
 * The scope's terminal sessions with a "Start terminal" action: the body of
 * the panel's Terminal launcher and of `/threads/[id]/terminal`. Selecting a
 * session hands its id to the caller (a panel tab or the full-screen route).
 */

interface TerminalSessionsListProps {
  listScope: TerminalQueryScope;
  createScope: TerminalCreateScope;
  onOpenTerminal: (terminalId: string) => void;
  /** What the session cards sit on: the grouped page (full screen) or the panel's raised surface. */
  surface?: GroupedSurface;
  testID?: string;
}

export function TerminalSessionsList(props: TerminalSessionsListProps) {
  // Rendered inside the panel sheet's portal: it can outlive its screen.
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <View className="p-6" testID={props.testID ?? "terminal-sessions"}>
        <Text variant="footnote" tone="muted" className="text-center">
          No active server.
        </Text>
      </View>
    );
  }
  return <ConnectedTerminalSessionsList {...props} />;
}

function ConnectedTerminalSessionsList({
  listScope,
  createScope,
  onOpenTerminal,
  surface = "grouped",
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
    <View className="gap-6 px-4 pb-8 pt-3" testID={testID}>
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
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </View>
      ) : terminalsQuery.error && !terminalsQuery.data ? (
        <View className="items-center gap-1 py-4">
          <Text variant="footnote" tone="destructive" className="text-center">
            Failed to load terminals.
          </Text>
          <Text variant="caption" className="text-center" selectable>
            {terminalsQuery.error.message}
          </Text>
        </View>
      ) : sessions.length === 0 ? (
        <Text variant="footnote" tone="muted" className="py-4 text-center">
          No terminals
        </Text>
      ) : (
        <GroupedSection title="Sessions" surface={surface}>
          {sessions.map((session) => {
            const row = describeTerminalSessionRow(session);
            return (
              <GroupedRow
                key={session.id}
                leading="Terminal"
                title={row.title}
                subtitle={row.subtitle}
                trailing="chevron"
                disabled={!row.active}
                onPress={() => onOpenTerminal(session.id)}
                testID={`terminal-session-row-${session.id}`}
              />
            );
          })}
        </GroupedSection>
      )}
    </View>
  );
}

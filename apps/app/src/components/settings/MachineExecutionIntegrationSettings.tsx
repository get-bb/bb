import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { sdk } from "@/lib/sdk";
import { hostQueryKey } from "@/hooks/queries/query-keys";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { invalidateSystemConfig } from "@/hooks/cache-owners/system-cache-effects";
import {
  SettingsDetailRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";

export function MachineExecutionIntegrationSettings({
  hostId,
}: {
  hostId: string;
}) {
  const queryClient = useQueryClient();
  const config = useSystemConfig();
  const query = useQuery({
    queryKey: [...hostQueryKey(hostId), "execution-integration"],
    queryFn: ({ signal }) =>
      sdk.hosts.experimental_getExecutionIntegration({ hostId, signal }),
  });
  useEffect(() => {
    void query.refetch();
  }, [config.dataUpdatedAt, query.refetch]);
  const mutation = useMutation({
    mutationFn: (integrationId: string | null) =>
      sdk.hosts.experimental_setExecutionIntegration({ hostId, integrationId }),
    onSuccess: async () => {
      await query.refetch();
      invalidateSystemConfig({ queryClient });
    },
  });
  const required = query.data?.required;
  return (
    <SettingsSection
      title="Agent execution"
      description="Choose who runs agents on this machine. Harness and model stay separate. Existing sessions keep their execution owner."
    >
      <SettingsRowList>
        <SettingsDetailRow label="Run agents through">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Run agents through"
                variant="outline"
                disabled={!query.data || mutation.isPending}
              >
                {query.data
                  ? required
                    ? `${required.displayName}${required.available ? "" : " (unavailable)"}`
                    : "BB"
                  : query.isError
                    ? "Unavailable"
                    : "Loading…"}
                <Icon name="ChevronDown" className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" mobileTitle="Run agents through">
              <DropdownMenuItem
                role="menuitemradio"
                aria-checked={!required}
                onSelect={() => mutation.mutate(null)}
                className="justify-between"
              >
                BB {!required ? <Icon name="Check" /> : null}
              </DropdownMenuItem>
              {required &&
              !query.data?.integrations.some(
                (entry) =>
                  entry.id === required.id &&
                  entry.pluginId === required.pluginId,
              ) ? (
                <DropdownMenuItem
                  role="menuitemradio"
                  aria-checked
                  disabled
                  className="justify-between"
                >
                  {required.displayName} (unavailable) <Icon name="Check" />
                </DropdownMenuItem>
              ) : null}
              {query.data?.integrations.map((entry) => {
                const selected =
                  required?.id === entry.id &&
                  required.pluginId === entry.pluginId;
                return (
                  <DropdownMenuItem
                    key={entry.id}
                    role="menuitemradio"
                    aria-checked={selected}
                    disabled={!entry.available}
                    onSelect={() => mutation.mutate(entry.id)}
                    className="justify-between"
                  >
                    {entry.displayName}
                    {entry.available ? "" : " (unavailable)"}{" "}
                    {selected ? <Icon name="Check" /> : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingsDetailRow>
      </SettingsRowList>
      {required && !required.available ? (
        <p role="status" className="text-sm text-muted-foreground">
          Enable the required integration to run agents. BB will not switch
          execution backends automatically.
        </p>
      ) : null}
      {query.error || mutation.error ? (
        <p role="alert" className="text-sm text-destructive">
          {(mutation.error ?? query.error)?.message}
        </p>
      ) : null}
    </SettingsSection>
  );
}

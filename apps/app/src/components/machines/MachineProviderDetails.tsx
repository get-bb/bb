import { useQuery } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";

export function MachineProviderDetails({
  hostId,
  expanded = false,
}: {
  hostId: string;
  expanded?: boolean;
}) {
  const query = useQuery({
    queryKey: ["machine-provider-details", hostId],
    queryFn: ({ signal }) =>
      sdk.hosts.experimental_providerDetails({ hostId, signal }),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  if (query.error)
    return (
      <p className="text-xs text-muted-foreground">
        Provider inventory unavailable
      </p>
    );
  if (!query.data) return null;
  return (
    <div className="min-w-0 text-xs text-muted-foreground">
      <p className={expanded ? "whitespace-pre-wrap" : "line-clamp-2"}>
        {query.data.summary}
      </p>
    </div>
  );
}

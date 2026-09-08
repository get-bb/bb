import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import { sdk } from "@/lib/sdk";

export function MachineLifecycleNotice({
  hostId,
  onRemove,
}: {
  hostId: string;
  onRemove: () => void;
}) {
  const query = useQuery({
    queryKey: ["machine-lifecycle", hostId],
    queryFn: () => sdk.hosts.experimental_lifecycle({ hostId }),
    refetchInterval: 10_000,
  });
  const keep = useMutation({
    mutationFn: (value: boolean) =>
      sdk.hosts.experimental_lifecycle({ hostId, keep: value }),
    onSuccess: () => query.refetch(),
  });
  const lifecycle = query.data;
  if (
    !lifecycle ||
    (lifecycle.expiresAt === null &&
      lifecycle.retentionAt === null &&
      lifecycle.lastSnapshotAt === null &&
      lifecycle.message === null &&
      lifecycle.recoveryState !== "recoverable" &&
      lifecycle.recoveryState !== "lost-since-last-snapshot")
  )
    return null;
  const approaching =
    lifecycle.maintenanceAt !== null &&
    lifecycle.maintenanceAt <= Date.now() + 15 * 60_000;
  return (
    <div
      className="flex min-w-0 flex-col gap-2 text-xs"
      aria-label="Machine preservation and retention"
    >
      {approaching && (
        <p role="status">
          Preservation scheduled for{" "}
          {new Date(lifecycle.maintenanceAt ?? 0).toLocaleString()}. Active
          turns will be interrupted and terminals closed.
        </p>
      )}
      {lifecycle.message && <p role="status">{lifecycle.message}</p>}
      {!lifecycle.message &&
        (lifecycle.recoveryState === "recoverable" ||
          lifecycle.recoveryState === "lost-since-last-snapshot") && (
          <p role="alert">
            {lifecycle.recoveryState === "lost-since-last-snapshot"
              ? "Machine preservation was lost. Explicit recovery is required."
              : "Machine preservation failed. Recovery is required."}
          </p>
        )}
      {lifecycle.lastSnapshotAt !== null && (
        <p>Last saved {new Date(lifecycle.lastSnapshotAt).toLocaleString()}.</p>
      )}
      {lifecycle.retentionAt !== null && (
        <p>
          {lifecycle.keep
            ? "Automatic deletion disabled. Retention date:"
            : "Automatically deletes after retention:"}{" "}
          {new Date(lifecycle.retentionAt).toLocaleString()}.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={keep.isPending}
          onClick={() => keep.mutate(!lifecycle.keep)}
        >
          {lifecycle.keep ? "Allow automatic deletion" : "Keep machine"}
        </Button>
        <Button size="sm" variant="outline" onClick={onRemove}>
          Remove machine
        </Button>
      </div>
      {keep.error && (
        <p role="alert">Could not update retention: {keep.error.message}</p>
      )}
    </div>
  );
}

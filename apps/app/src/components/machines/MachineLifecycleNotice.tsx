import { useQuery } from "@tanstack/react-query";
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
  const lifecycle = query.data;
  if (!lifecycle || lifecycle.message === null) return null;
  return (
    <div
      className="flex min-w-0 flex-col gap-2 text-xs"
      aria-label="Machine maintenance"
    >
      <p role="status">{lifecycle.message}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onRemove}>
          Remove machine
        </Button>
      </div>
    </div>
  );
}

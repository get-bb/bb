import { Skeleton } from "@bb/shared-ui/skeleton";

export function ListLoadingPlaceholder({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3 px-3 py-4">
      <span className="sr-only">{label}</span>
      <Skeleton aria-hidden className="h-3 w-3/4" />
      <Skeleton aria-hidden className="h-3 w-1/2" />
      <Skeleton aria-hidden className="h-3 w-2/3" />
    </div>
  );
}

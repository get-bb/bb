import { Pill } from "@bb/shared-ui/pill";

/** Shared passive provenance badge for resources managed by bb. */
export function ProvenancePill({ label }: { label: string }) {
  return (
    <Pill
      variant="outline"
      size="sm"
      className="rounded-md border-border/40 bg-surface-recessed/45 px-1.5 py-0 text-2xs font-medium leading-none text-subtle-foreground shadow-none"
    >
      {label}
    </Pill>
  );
}

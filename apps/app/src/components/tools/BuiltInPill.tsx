import { Pill } from "@bb/shared-ui/pill";

/** Shared passive provenance badge for resources that ship with bb. */
export function BuiltInPill() {
  return (
    <Pill
      variant="secondary"
      size="sm"
      className="rounded-md border border-border/70 bg-secondary px-2 py-0.5 text-2xs font-semibold leading-none text-secondary-foreground shadow-none"
    >
      Built-in
    </Pill>
  );
}

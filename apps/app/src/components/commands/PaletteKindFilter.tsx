import { useAtom } from "jotai";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import {
  THREAD_LIFECYCLE_OPTIONS,
  ThreadLifecycleFilterItems,
} from "@/components/thread/ThreadLifecycleFilter";
import {
  paletteKindFilterAtom,
  paletteThreadLifecyclesAtom,
  type PaletteKindFilter as PaletteKindFilterValue,
} from "@/lib/command-palette/palette-preferences";
import { normalizeThreadLifecycleFilter } from "@/lib/thread-lifecycle-filter";

const KIND_OPTIONS = [
  { value: "all", label: "All" },
  { value: "threads", label: "Threads" },
] as const satisfies readonly { value: PaletteKindFilterValue; label: string }[];

function isKindFilterValue(value: string): value is PaletteKindFilterValue {
  return KIND_OPTIONS.some((option) => option.value === value);
}

export function PaletteKindFilter() {
  const [kind, setKind] = useAtom(paletteKindFilterAtom);
  const [savedLifecycles, setLifecycles] = useAtom(paletteThreadLifecyclesAtom);
  const lifecycles = normalizeThreadLifecycleFilter(savedLifecycles);
  const lifecycleLabel =
    lifecycles.length === THREAD_LIFECYCLE_OPTIONS.length
      ? "Active, Archived"
      : THREAD_LIFECYCLE_OPTIONS.filter((option) =>
          lifecycles.includes(option.value),
        )
          .map((option) => option.label)
          .join(", ");
  const label =
    kind === "all"
      ? "All"
      : lifecycleLabel === "Active"
        ? "Threads"
        : `Threads · ${lifecycleLabel}`;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 max-w-full justify-start font-normal text-subtle-foreground"
          aria-label={`Filter: ${label}`}
        >
          <Icon
            name="SlidersHorizontal"
            className="size-3.5 shrink-0"
            aria-hidden
          />
          <span className="truncate">{label}</span>
          <Icon name="ChevronDown" className="size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" mobileTitle="Filter">
        <DropdownMenuGroup aria-label="Show">
          <DropdownMenuLabel>Show</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={kind}
            onValueChange={(value) => {
              if (isKindFilterValue(value)) setKind(value);
            }}
          >
            {KIND_OPTIONS.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                onSelect={(event) => event.preventDefault()}
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {kind === "threads" ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup aria-label="Threads">
              <DropdownMenuLabel>Threads</DropdownMenuLabel>
              <ThreadLifecycleFilterItems
                value={lifecycles}
                onChange={setLifecycles}
              />
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

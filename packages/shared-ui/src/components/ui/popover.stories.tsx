import { useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "./popover.js";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Popover",
};

interface PickerMachine {
  id: string;
  name: string;
  connected: boolean;
}

const PICKER_MACHINES: PickerMachine[] = [
  { id: "local", name: "This machine", connected: true },
  { id: "staging-01", name: "staging-01", connected: true },
  { id: "staging-02", name: "staging-02", connected: false },
];

function SearchablePickerDemo() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("local");
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(
    () =>
      PICKER_MACHINES.filter((machine) =>
        machine.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );
  const selected = PICKER_MACHINES.find(
    (machine) => machine.id === selectedId,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label="Machine"
        >
          {selected?.name ?? "Select machine"}
          <Icon
            name="ChevronDown"
            className="ml-1 size-3.5 text-muted-foreground"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" autoFocusRef={inputRef} className="w-64 p-0">
        <Command shouldFilter={false} label="Search machines">
          <CommandInput
            ref={inputRef}
            aria-label="Search machines"
            placeholder="Search machines"
            value={query}
            onValueChange={setQuery}
            className="h-8 text-xs"
          />
          <CommandList>
            <CommandGroup>
              {filtered.map((machine) => (
                <CommandItem
                  key={machine.id}
                  value={machine.id}
                  disabled={!machine.connected}
                  onSelect={() => {
                    setSelectedId(machine.id);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {machine.name}
                  </span>
                  {machine.connected ? null : (
                    <span className="ml-auto text-2xs text-muted-foreground">
                      offline
                    </span>
                  )}
                  <Icon
                    name="Check"
                    className={
                      machine.id === selectedId
                        ? "ml-1 size-3.5 opacity-100"
                        : "ml-1 size-3.5 opacity-0"
                    }
                  />
                </CommandItem>
              ))}
              {filtered.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No machines found
                </div>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function HoverMenuDemo() {
  const [open, setOpen] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimeoutRef.current === null) return;
    window.clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimeoutRef.current = window.setTimeout(() => setOpen(false), 150);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Pane arrangement"
          onPointerEnter={() => {
            cancelClose();
            setOpen(true);
          }}
          onPointerLeave={scheduleClose}
          onFocus={() => {
            cancelClose();
            setOpen(true);
          }}
          onBlur={scheduleClose}
        >
          <Icon name="Maximize2" className="size-4" />
        </Button>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        className="w-40 p-1"
      >
        {["Move left", "Move right", "Move top", "Move bottom"].map(
          (label) => (
            <button
              key={label}
              type="button"
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              {label}
            </button>
          ),
        )}
      </PopoverContent>
    </Popover>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Searchable picker"
        hint="apps/app/src/components/pickers/MachinePicker.tsx — Popover anchors a Command combobox via PopoverTrigger, simplified to a static machine list"
      >
        <SearchablePickerDemo />
      </StoryRow>
      <StoryRow
        label="Hover menu"
        hint="apps/app/src/views/thread-detail/PaneMaximizeButton.tsx — PopoverAnchor (not PopoverTrigger) lets the real app open the menu on hover via a shared, app-internal useHoverPopover hook. This demo reimplements only the pointer-hover and close-delay behavior locally as a stand-in — it does not reproduce that hook's keyboard-focus handling"
      >
        <HoverMenuDemo />
      </StoryRow>
    </StoryCard>
  );
}

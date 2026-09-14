import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import type { BranchRef } from "../contract.js";

function shortNameOf(branches: readonly BranchRef[], fullName: string): string {
  return (
    branches.find((branch) => branch.fullName === fullName)?.shortName ??
    fullName.replace(/^refs\/(heads|remotes)\//u, "")
  );
}

export function BranchPicker({
  branches,
  selected,
  onChange,
}: {
  branches: readonly BranchRef[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const keepOpen = (event: Event) => event.preventDefault();
  const selectedNames = selected.map((fullName) =>
    shortNameOf(branches, fullName),
  );
  const label =
    selectedNames.length === 0
      ? "Show All"
      : selectedNames.length === 1
        ? selectedNames[0]
        : `${selectedNames.length} branches`;
  const locals = branches.filter((branch) => !branch.isRemote);
  const remotes = branches.filter((branch) => branch.isRemote);

  const renderBranch = (branch: BranchRef) => (
    <DropdownMenuCheckboxItem
      key={branch.fullName}
      checked={selected.includes(branch.fullName)}
      onSelect={keepOpen}
      onCheckedChange={(checked) => {
        const others = selected.filter((name) => name !== branch.fullName);
        onChange(checked === true ? [...others, branch.fullName] : others);
      }}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`truncate ${branch.isHead ? "font-semibold" : ""}`}>
          {branch.shortName}
        </span>
        {branch.isHead ? (
          <span className="shrink-0 text-muted-foreground">· current</span>
        ) : null}
      </span>
    </DropdownMenuCheckboxItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Branches"
          title={
            selectedNames.length > 1 ? selectedNames.join(", ") : undefined
          }
          className="flex h-8 min-w-32 max-w-56 flex-1 shrink items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 text-xs hover:bg-accent/50 focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <span className="truncate">{label}</span>
          <Icon name="ChevronDown" className="size-4 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        mobileTitle="Branches"
        className="max-h-80 min-w-56 overflow-y-auto"
      >
        <DropdownMenuCheckboxItem
          checked={selected.length === 0}
          onSelect={keepOpen}
          onCheckedChange={() => onChange([])}
        >
          Show All
        </DropdownMenuCheckboxItem>
        {locals.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Local branches</DropdownMenuLabel>
            {locals.map(renderBranch)}
          </>
        ) : null}
        {remotes.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Remote branches</DropdownMenuLabel>
            {remotes.map(renderBranch)}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  BRANCH_PICKER_CONTENT_CLASS_NAME,
  BranchPickerRow,
  BranchPickerSearch,
  BranchPickerSectionHeader,
} from "@bb/shared-ui/branch-picker-primitives";
import { Button } from "@bb/shared-ui/button";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { MenuHoverProvider } from "@bb/shared-ui/menu-item-hover";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";
import { blurActiveKeyboardInputWithin } from "@bb/shared-ui/overlay-trigger";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import {
  definePluginApp,
  experimental_useProjects,
  experimental_useProjectSourceBranches,
  type PluginBrowserBbSdk,
  type JsonValue,
  type PluginEnvironmentProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import type { CheckoutBranchSelection } from "./contract.js";
import { PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";

const CREATE_NEW_BRANCH_LABEL = "New branch";
const BRANCH_LABEL_PREFIXES = [
  "Current:",
  "Checkout:",
  "New branch from:",
] as const;
const CURRENT_PARENTHESES_LABEL_PREFIX = "Current (";

type CheckoutData =
  | Awaited<ReturnType<PluginBrowserBbSdk["projects"]["branches"]>>
  | undefined;
const EMPTY_BRANCHES: string[] = [];

interface CheckoutInputsValue {
  path: string | null;
  branch: CheckoutBranchSelection | null;
}

interface CheckoutBlocker {
  label: string;
  reason: string;
  guidance: string;
}

type CheckoutIntent = "current" | "new" | "checkout";

type BranchLabelParts =
  | { kind: "plain"; value: string }
  | { kind: "prefixed"; prefix: string; value: string }
  | { kind: "parenthetical"; prefix: string; value: string };

function readBranch(
  branch: JsonValue | undefined,
): CheckoutBranchSelection | null {
  if (typeof branch !== "object" || branch === null || Array.isArray(branch)) {
    return null;
  }
  if (branch.kind === "existing" && typeof branch.name === "string") {
    return { kind: "existing", name: branch.name };
  }
  if (branch.kind === "new" && typeof branch.baseBranch === "string") {
    return { kind: "new", baseBranch: branch.baseBranch };
  }
  return null;
}

export function readCheckoutInputs(
  value: JsonValue | null,
): CheckoutInputsValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { path: null, branch: null };
  }
  return {
    path: typeof value.path === "string" ? value.path : null,
    branch: readBranch(value.branch),
  };
}

export function buildCheckoutInputs(inputs: CheckoutInputsValue): JsonValue {
  return {
    ...(inputs.path === null ? {} : { path: inputs.path }),
    ...(inputs.branch === null ? {} : { branch: inputs.branch }),
  };
}

function operationName(state: NonNullable<CheckoutData>): string {
  switch (state.operation.kind) {
    case "merge":
      return "Merge";
    case "rebase":
      return "Rebase";
    case "cherry-pick":
      return "Cherry-pick";
    case "revert":
      return "Revert";
    case "unknown":
      return "Operation";
    case "none":
      return "";
  }
}

export function checkoutBlocker(state: CheckoutData): CheckoutBlocker | null {
  if (state === undefined) {
    return {
      label: "Checking",
      reason: "Checking checkout state",
      guidance: "Checking whether branch changes are available…",
    };
  }
  if (state.checkout.kind === "unknown") {
    return {
      label: "Unknown",
      reason: "Checkout state is unavailable",
      guidance:
        "Branch changes are unavailable because this checkout could not be inspected.",
    };
  }
  if (state.operation.kind !== "none") {
    if (state.operation.hasConflicts) {
      return {
        label: "Conflicts",
        reason: "Checkout blocked by unresolved conflicts",
        guidance:
          "Resolve the conflicts and finish or abort the Git operation to change branches.",
      };
    }
    const name = operationName(state);
    return {
      label: name,
      reason: `Checkout blocked by an in-progress ${name.toLowerCase()}`,
      guidance: `Finish or abort the ${name.toLowerCase()} to change branches.`,
    };
  }
  if (state.hasUncommittedChanges) {
    return {
      label: "Dirty",
      reason: "Checkout blocked by uncommitted changes",
      guidance:
        "Commit or stash the uncommitted changes in this checkout to create or switch branches.",
    };
  }
  if (state?.checkout.kind === "detached") {
    return {
      label: "Detached",
      reason: "Checkout blocked while HEAD is detached",
      guidance:
        "Attach HEAD to a branch in this checkout to create or switch branches here.",
    };
  }
  if (state?.checkout.kind === "unborn") {
    return {
      label: "Empty repo",
      reason: "Checkout blocked before the first commit",
      guidance:
        "Create the first commit in this checkout to create or switch branches.",
    };
  }
  return null;
}

function currentMenuLabel(state: CheckoutData): string {
  if (state?.checkout.kind === "branch")
    return `Current: ${state.checkout.branchName}`;
  if (state?.checkout.kind === "detached") return "Current (detached)";
  if (state?.checkout.kind === "unborn") return "Current (empty repo)";
  if (state === undefined) return "Checking checkout";
  return "Unknown checkout";
}

function currentTriggerLabel(state: CheckoutData): string {
  return state?.checkout.kind === "branch"
    ? `Current (${state.checkout.branchName})`
    : currentMenuLabel(state);
}

function resolveCheckoutIntent(
  branch: CheckoutBranchSelection | null,
): CheckoutIntent {
  if (branch?.kind === "new") return "new";
  if (branch?.kind === "existing") return "checkout";
  return "current";
}

function splitBranchLabel(label: string): BranchLabelParts {
  if (
    label.startsWith(CURRENT_PARENTHESES_LABEL_PREFIX) &&
    label.endsWith(")")
  ) {
    return {
      kind: "parenthetical",
      prefix: "Current",
      value: label.slice(CURRENT_PARENTHESES_LABEL_PREFIX.length, -1),
    };
  }
  for (const prefix of BRANCH_LABEL_PREFIXES) {
    const prefixWithSpace = `${prefix} `;
    if (label.startsWith(prefixWithSpace)) {
      return {
        kind: "prefixed",
        prefix,
        value: label.slice(prefixWithSpace.length),
      };
    }
  }
  return { kind: "plain", value: label };
}

function BranchPickerText({
  label,
  className,
  compactAffixesInPromptbox = false,
  wrap = false,
}: {
  label: string;
  className?: string;
  compactAffixesInPromptbox?: boolean;
  wrap?: boolean;
}) {
  const valueClassName = wrap
    ? "min-w-0 whitespace-normal break-words"
    : "min-w-0 truncate";
  const compactAffixProps = compactAffixesInPromptbox
    ? { "data-promptbox-hide-compact": "" }
    : {};
  if (label === CREATE_NEW_BRANCH_LABEL) {
    return (
      <span className={cn("flex min-w-0 items-baseline gap-1", className)}>
        <span className={valueClassName}>New</span>
        <span {...compactAffixProps} className="shrink-0 text-muted-foreground">
          branch
        </span>
      </span>
    );
  }
  const parts = splitBranchLabel(label);
  if (parts.kind === "plain") {
    return <span className={cn(valueClassName, className)}>{parts.value}</span>;
  }
  if (parts.kind === "parenthetical") {
    return (
      <span
        className={cn(
          "flex min-w-0 items-baseline",
          wrap && "flex-wrap",
          className,
        )}
      >
        <span {...compactAffixProps} className="shrink-0 text-muted-foreground">
          {parts.prefix} (
        </span>
        <span className={cn(valueClassName, "font-medium text-foreground")}>
          {parts.value}
        </span>
        <span {...compactAffixProps} className="shrink-0 text-muted-foreground">
          )
        </span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex min-w-0 items-baseline gap-1",
        wrap && "flex-wrap",
        className,
      )}
    >
      <span {...compactAffixProps} className="shrink-0 text-muted-foreground">
        {parts.prefix}
      </span>
      <span className={cn(valueClassName, "font-medium text-foreground")}>
        {parts.value}
      </span>
    </span>
  );
}

function filterBranches(branches: readonly string[], query: string): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return [...branches];
  return branches.filter((branch) =>
    branch.toLowerCase().includes(normalizedQuery),
  );
}

function orderBranches(
  branches: readonly string[],
  selected: string | null,
): string[] {
  if (selected === null || !branches.includes(selected)) return [...branches];
  return [selected, ...branches.filter((branch) => branch !== selected)];
}

function CheckoutInputsControl({
  projectId,
  target,
  value,
  onChange,
}: PluginEnvironmentProviderInputsProps) {
  const hostId = target.kind === "existing-host" ? target.hostId : null;
  const inputs = useMemo(() => readCheckoutInputs(value), [value]);
  const selectedCheckoutIntent = resolveCheckoutIntent(inputs.branch);
  const [checkoutIntent, setCheckoutIntent] = useState<CheckoutIntent>(
    selectedCheckoutIntent,
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const projects = experimental_useProjects({
    enabled: hostId === null && projectId !== null,
  });
  const sources = projects.data?.find(
    (project) => project.id === projectId,
  )?.sources;
  const source =
    sources?.find(
      (source) => source.type === "local_path" && source.isDefault,
    ) ?? sources?.find((source) => source.type === "local_path");
  const branchesQuery = experimental_useProjectSourceBranches(
    projectId,
    hostId ?? source?.hostId ?? null,
    {
      query: deferredQuery.trim().toLowerCase(),
    },
  );
  const branches = branchesQuery.data?.branches ?? EMPTY_BRANCHES;
  const remoteBranches = branchesQuery.data?.remoteBranches ?? EMPTY_BRANCHES;
  const checkout = branchesQuery.data;
  const inputRef = useRef<HTMLInputElement>(null);
  const optionsScrollRef = useRef<HTMLDivElement>(null);
  const blocker = hostId === null ? null : checkoutBlocker(checkout);
  const nextInputs = useMemo(
    () => buildCheckoutInputs(inputs),
    [inputs.branch, inputs.path],
  );
  const blockerReason = blocker?.reason ?? null;

  useEffect(() => {
    if (inputs.branch !== null && blockerReason !== null) {
      onChange({ status: "blocked", reason: blockerReason });
      return;
    }
    onChange({ status: "ready", value: nextInputs });
  }, [blockerReason, inputs.branch, nextInputs, onChange]);

  useEffect(() => {
    if (open) setCheckoutIntent(selectedCheckoutIntent);
  }, [open, selectedCheckoutIntent]);

  useEffect(() => {
    if (optionsScrollRef.current) optionsScrollRef.current.scrollTop = 0;
  }, [checkoutIntent, query]);

  const selectedBranchName =
    inputs.branch?.kind === "existing"
      ? inputs.branch.name
      : inputs.branch?.kind === "new"
        ? inputs.branch.baseBranch
        : null;
  const branchOptions = useMemo(() => {
    const choices =
      hostId === null
        ? remoteBranches
            .filter((branch) => branch.startsWith("origin/"))
            .map((branch) => branch.slice("origin/".length))
        : checkoutIntent === "new"
          ? [
              ...branches,
              ...remoteBranches.filter((branch) => !branches.includes(branch)),
            ]
          : [...branches];
    const filtered = filterBranches(choices, deferredQuery);
    const selectedBranch =
      query.trim().length === 0 ? selectedBranchName : null;
    return orderBranches(filtered, selectedBranch);
  }, [
    hostId,
    branches,
    remoteBranches,
    checkoutIntent,
    deferredQuery,
    query,
    selectedBranchName,
  ]);
  const currentOptionLabel =
    hostId === null ? "Default branch" : currentMenuLabel(checkout);
  const showBranchChooser = checkoutIntent !== "current";
  const showOptionsSearch = showBranchChooser && blocker === null;
  const triggerLabel =
    inputs.branch?.kind === "existing"
      ? `Checkout: ${inputs.branch.name}`
      : inputs.branch?.kind === "new"
        ? `New branch from: ${inputs.branch.baseBranch}`
        : hostId === null
          ? "Default branch"
          : currentTriggerLabel(checkout);
  const triggerTitle =
    blocker?.reason ??
    (inputs.branch?.kind === "existing"
      ? `Checkout branch: ${inputs.branch.name}`
      : inputs.branch?.kind === "new"
        ? `Create a new branch from ${inputs.branch.baseBranch}`
        : hostId === null
          ? "Use the repository’s default branch"
          : currentMenuLabel(checkout));
  const inputsDisabled = projectId === null;
  const updateBranch = (branch: CheckoutBranchSelection | null) => {
    onChange({
      status: "ready",
      value: buildCheckoutInputs({ path: inputs.path, branch }),
    });
  };
  const updateOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      blurActiveKeyboardInputWithin(inputRef.current);
      setQuery("");
    } else {
      void branchesQuery.refreshFromRemote().catch(() => undefined);
    }
    setOpen(nextOpen);
  };
  const closePicker = () => updateOpen(false);
  const selectBranchAndClose = (branch: string) => {
    updateBranch(
      checkoutIntent === "new"
        ? { kind: "new", baseBranch: branch }
        : { kind: "existing", name: branch },
    );
    closePicker();
  };

  return (
    <Popover open={open} onOpenChange={updateOpen}>
      <PopoverTrigger asChild disabled={inputsDisabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={inputsDisabled}
          aria-label="Branch"
          role="combobox"
          aria-expanded={open}
          className={cn(
            LIST_HOVER_TRANSITION,
            OPTION_BASE_CLASS_NAME,
            OPTION_INTERACTIVE_CLASS_NAME,
            OPTION_MUTED_CLASS_NAME,
          )}
        >
          <span
            className={OPTION_TRIGGER_CONTENT_CLASS_NAME}
            title={triggerTitle}
          >
            <Icon
              name="GitMerge"
              className={COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS}
            />
            <BranchPickerText
              label={triggerLabel}
              className="truncate"
              compactAffixesInPromptbox
            />
          </span>
          <Icon
            name="ChevronDown"
            className={cn(
              "shrink-0 text-muted-foreground",
              COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={16}
        mobileTitle="Start from:"
        autoFocusRef={showOptionsSearch ? inputRef : undefined}
        className={cn(
          BRANCH_PICKER_CONTENT_CLASS_NAME,
          showOptionsSearch && "md:min-w-40",
        )}
      >
        <MenuHoverProvider>
          {showOptionsSearch ? (
            <BranchPickerSearch
              inputRef={inputRef}
              query={query}
              enterSelection={
                branchOptions[0] ?? (hostId === null ? query.trim() : undefined)
              }
              onEnterSelection={selectBranchAndClose}
              onQueryChange={setQuery}
              ariaLabel="Search branches"
            />
          ) : null}
          <div
            ref={optionsScrollRef}
            className="min-h-0 max-h-[60vh] overflow-y-auto overscroll-contain px-1 pb-1 pt-0 md:max-h-80"
            onWheel={(event) => event.stopPropagation()}
          >
            <BranchPickerSectionHeader label="Start from:" sticky={false} />
            <BranchPickerRow
              icon="GitMerge"
              selected={checkoutIntent === "current"}
              title={currentOptionLabel}
              onSelect={() => {
                setCheckoutIntent("current");
                updateBranch(null);
                closePicker();
              }}
            >
              <BranchPickerText
                label={currentOptionLabel}
                className="flex-1"
                wrap
              />
            </BranchPickerRow>
            <BranchPickerRow
              disabled={blocker !== null}
              icon="Plus"
              selected={checkoutIntent === "new"}
              title={blocker?.reason ?? CREATE_NEW_BRANCH_LABEL}
              onSelect={() => {
                setCheckoutIntent("new");
                const baseBranch =
                  selectedBranchName ??
                  (checkout?.checkout.kind === "branch"
                    ? checkout.checkout.branchName
                    : null);
                if (baseBranch !== null) {
                  updateBranch({ kind: "new", baseBranch });
                }
              }}
            >
              <BranchPickerText
                label={CREATE_NEW_BRANCH_LABEL}
                className="flex-1"
                wrap
              />
            </BranchPickerRow>
            <BranchPickerRow
              disabled={blocker !== null}
              icon="GitMerge"
              selected={checkoutIntent === "checkout"}
              title={blocker?.reason ?? "Checkout an existing branch"}
              onSelect={() => setCheckoutIntent("checkout")}
            >
              <BranchPickerText label="Checkout" className="flex-1" wrap />
            </BranchPickerRow>
            {blocker !== null ? (
              <p
                role="status"
                className="px-2 py-2 text-xs leading-snug text-muted-foreground"
              >
                {blocker.guidance}
              </p>
            ) : null}
            {showBranchChooser ? (
              <>
                <div className="my-1 h-px bg-border/60" />
                <BranchPickerSectionHeader
                  label={
                    checkoutIntent === "new" ? "Branch from:" : "Checkout:"
                  }
                />
                {blocker === null ? (
                  <>
                    {branchOptions.map((branch) => (
                      <BranchPickerRow
                        key={branch}
                        icon="GitMerge"
                        selected={branch === selectedBranchName}
                        title={branch}
                        onSelect={() => selectBranchAndClose(branch)}
                      >
                        <BranchPickerText
                          label={branch}
                          className="flex-1"
                          wrap
                        />
                      </BranchPickerRow>
                    ))}
                    {hostId === null &&
                    query.trim() &&
                    !branchOptions.includes(query.trim()) ? (
                      <BranchPickerRow
                        icon="GitMerge"
                        selected={false}
                        title={`Use ${query.trim()}`}
                        onSelect={() => selectBranchAndClose(query.trim())}
                      >
                        <BranchPickerText
                          label={`Use ${query.trim()}`}
                          className="flex-1"
                          wrap
                        />
                      </BranchPickerRow>
                    ) : null}
                    {branchOptions.length === 0 &&
                    !(hostId === null && query.trim()) ? (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                        {branchesQuery.isFetching
                          ? "Loading branches..."
                          : checkoutIntent === "checkout"
                            ? "No local branches found."
                            : "No branches found."}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </MenuHoverProvider>
      </PopoverContent>
    </Popover>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
    component: CheckoutInputsControl,
  });
});

import type { Host } from "@bb/domain";
import { useMemo } from "react";
import { View } from "react-native";
import type {
  ReuseEnvironmentOption,
  ThreadEnvironmentSelection,
} from "@/data/compose";
import { useTheme } from "@/theme";
import {
  Icon,
  ListRow,
  Separator,
  Sheet,
  Spinner,
  Text,
  useSheet,
  type IconName,
} from "@/ui";
import { usePickerSheetMaxHeight } from "./OptionSheet";
import { PickerTrigger } from "./PickerTrigger";

/** The mode rows the picker offers; reuse rows carry their environment id. */
export type EnvironmentPickerMode =
  | "project-default"
  | "local"
  | "worktree"
  | "reuse";

export interface EnvironmentPickerProps {
  /** The effective selection (after `resolveEffectiveEnvironmentSelection`). */
  value: ThreadEnvironmentSelection;
  onChange: (selection: ThreadEnvironmentSelection) => void;
  /** Machine host-mode rows target: the selected host, else the primary. */
  host: Host | null;
  /** Whether that machine holds a checkout of the project (always for personal). */
  hostHasSource: boolean;
  /** The server's primary host; the pill names any other machine explicitly. */
  primaryHostId?: string | null;
  isPersonalProject: boolean;
  reuseOptions: readonly ReuseEnvironmentOption[];
  reuseOptionsLoading: boolean;
  /** Why "New worktree" is unavailable on this checkout, or null. */
  worktreeDisabledReason: string | null;
  disabled?: boolean;
  testID?: string;
}

interface SelectedSummary {
  label: string;
  icon: IconName;
  tone: "default" | "warning";
}

export function describeEnvironmentSelection(
  value: ThreadEnvironmentSelection,
  host: Host | null,
  reuseOptions: readonly ReuseEnvironmentOption[],
  /** Name the machine in the label only when it is not the primary host. */
  primaryHostId: string | null = null,
): SelectedSummary {
  switch (value.type) {
    case "project-default":
      return { label: "Project default", icon: "Laptop", tone: "default" };
    case "reuse": {
      const option = reuseOptions.find(
        (candidate) => candidate.environmentId === value.environmentId,
      );
      const name = option?.name ?? option?.branchName;
      return {
        label: name ? `Reuse ${name}` : "Reuse worktree",
        icon: "FolderGit",
        tone: "default",
      };
    }
    case "host": {
      const offline = host !== null && host.status !== "connected";
      const machine =
        host !== null && host.id !== primaryHostId ? host.name : undefined;
      if (value.workspace.type === "managed-worktree") {
        return {
          label: machine ? `${machine} · New worktree` : "New worktree",
          icon: "FolderGit",
          tone: offline ? "warning" : "default",
        };
      }
      if (value.workspace.type === "personal") {
        return {
          label: machine ? `${machine} · Personal` : "Personal workspace",
          icon: "Laptop",
          tone: offline ? "warning" : "default",
        };
      }
      const custom = value.workspace.path;
      return {
        label: custom
          ? `${machine ? `${machine} · ` : ""}${custom}`
          : machine
            ? `${machine} · Checkout`
            : "Work in checkout",
        icon: "Folder",
        tone: offline ? "warning" : "default",
      };
    }
  }
}

/**
 * Environment (where the thread runs) picker: project default (server
 * policy), work in the project checkout on a machine, a new managed
 * worktree, or reuse an existing worktree from the project's threads.
 * Branch and path refinements have their own pickers.
 */
export function EnvironmentPicker({
  value,
  onChange,
  host,
  hostHasSource,
  primaryHostId = null,
  isPersonalProject,
  reuseOptions,
  reuseOptionsLoading,
  worktreeDisabledReason,
  disabled,
  testID = "environment-picker",
}: EnvironmentPickerProps) {
  const sheet = useSheet();
  const { tokens } = useTheme();
  const maxHeight = usePickerSheetMaxHeight();
  const summary = useMemo(
    () =>
      describeEnvironmentSelection(value, host, reuseOptions, primaryHostId),
    [host, primaryHostId, reuseOptions, value],
  );
  const hostUnavailableReason =
    host === null
      ? "No machine connected"
      : host.status !== "connected"
        ? `${host.name} is offline`
        : null;
  const hostId = host?.id ?? null;
  const workspaceDisabledReason =
    hostUnavailableReason ??
    (isPersonalProject || hostHasSource
      ? null
      : `${host?.name ?? "The selected machine"} has no checkout of this project`);
  const worktreeReason = isPersonalProject
    ? "Personal threads have no repository"
    : (workspaceDisabledReason ?? worktreeDisabledReason);
  const reuseReason = isPersonalProject
    ? "Personal threads have no worktrees"
    : reuseOptionsLoading
      ? null
      : reuseOptions.length === 0
        ? "No worktrees in this project yet"
        : null;

  const selectedMode: EnvironmentPickerMode =
    value.type === "project-default"
      ? "project-default"
      : value.type === "reuse"
        ? "reuse"
        : value.workspace.type === "managed-worktree"
          ? "worktree"
          : "local";

  const pick = (selection: ThreadEnvironmentSelection) => {
    sheet.dismiss();
    onChange(selection);
  };

  return (
    <>
      <PickerTrigger
        icon={summary.icon}
        label={summary.label}
        tone={summary.tone}
        onPress={sheet.present}
        disabled={disabled}
        testID={testID}
        accessibilityLabel="Environment"
      />
      <Sheet
        controller={sheet}
        title="Environment"
        layout="scroll"
        maxDynamicContentSize={maxHeight}
      >
        <ModeRow
          label="Project default"
          description={
            isPersonalProject
              ? "Personal workspace on the primary machine."
              : "bb picks: a fresh worktree from the default branch on the primary machine."
          }
          icon="Laptop"
          selected={selectedMode === "project-default"}
          onPress={() => pick({ type: "project-default" })}
          testID={`${testID}-option-project-default`}
        />
        <ModeRow
          label={
            isPersonalProject
              ? host
                ? `Personal workspace on ${host.name}`
                : "Personal workspace"
              : host
                ? `Work in the checkout on ${host.name}`
                : "Work in the checkout"
          }
          description={
            workspaceDisabledReason ??
            (isPersonalProject
              ? undefined
              : "Runs directly in the project folder; pick a branch or path next.")
          }
          icon="Folder"
          selected={selectedMode === "local"}
          disabled={workspaceDisabledReason !== null || hostId === null}
          onPress={() => {
            if (hostId === null) return;
            pick({
              type: "host",
              hostId,
              workspace: isPersonalProject
                ? { type: "personal" }
                : { type: "unmanaged", path: null, branch: null },
            });
          }}
          testID={`${testID}-option-local`}
        />
        <ModeRow
          label="New worktree"
          description={
            worktreeReason ?? "Creates a worktree from a base branch you pick."
          }
          icon="FolderGit"
          selected={selectedMode === "worktree"}
          disabled={worktreeReason !== null || hostId === null}
          onPress={() => {
            if (hostId === null) return;
            pick({
              type: "host",
              hostId,
              workspace: { type: "managed-worktree", baseBranch: null },
            });
          }}
          testID={`${testID}-option-worktree`}
        />
        <Separator />
        <View className="px-4 pb-1 pt-3">
          <Text variant="sectionLabel">Existing worktrees</Text>
        </View>
        {reuseReason ? (
          <View className="px-4 pb-4 pt-1">
            <Text variant="caption">{reuseReason}</Text>
          </View>
        ) : reuseOptionsLoading && reuseOptions.length === 0 ? (
          <View className="flex-row items-center gap-2 px-4 py-3">
            <Spinner />
            <Text variant="caption">Loading worktrees…</Text>
          </View>
        ) : (
          reuseOptions.map((option) => {
            const isSelected =
              value.type === "reuse" &&
              value.environmentId === option.environmentId;
            const title =
              option.name ?? option.branchName ?? option.environmentId;
            const threadPreview = option.threads
              .slice(0, 2)
              .map((thread) => thread.title)
              .join(" · ");
            const subtitle = [
              option.hostName,
              option.name && option.branchName ? option.branchName : null,
              threadPreview || null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <ListRow
                key={option.environmentId}
                title={title}
                subtitle={subtitle || undefined}
                leading="FolderGit"
                selected={isSelected}
                trailing={
                  isSelected ? (
                    <Icon name="Check" size={18} color={tokens.foreground} />
                  ) : null
                }
                onPress={() =>
                  pick({ type: "reuse", environmentId: option.environmentId })
                }
                testID={`${testID}-option-reuse-${option.environmentId}`}
              />
            );
          })
        )}
      </Sheet>
    </>
  );
}

interface ModeRowProps {
  label: string;
  description?: string;
  icon: IconName;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}

function ModeRow({
  label,
  description,
  icon,
  selected,
  disabled = false,
  onPress,
  testID,
}: ModeRowProps) {
  const { tokens } = useTheme();
  return (
    <ListRow
      title={label}
      subtitle={description}
      leading={icon}
      selected={selected}
      disabled={disabled}
      trailing={
        selected ? (
          <Icon name="Check" size={18} color={tokens.foreground} />
        ) : null
      }
      onPress={onPress}
      testID={testID}
    />
  );
}

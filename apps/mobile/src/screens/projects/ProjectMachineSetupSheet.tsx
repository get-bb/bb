import {
  getProjectPathValidationMessage,
  normalizeProjectPathInput,
  type ProjectSource,
} from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useHostCloneDefaultPath } from "@/data/hosts";
import { useAddProjectSource } from "@/data/projects";
import { useTheme } from "@/theme";
import { Button, cn, Sheet, Spinner, Text, type SheetController } from "@/ui";
import {
  describeRequestError,
  RemotePathBrowser,
  SheetInput,
  usePickerSheetMaxHeight,
} from "../pickers";

export interface ProjectMachineSetupTarget {
  projectId: string;
  projectName: string;
  /**
   * The project's git remote. Null (non-git project) still offers cloning
   * when `allowRemoteUrlEntry`, with a URL the user types.
   */
  gitRemoteUrl: string | null;
  hostId: string;
  hostName: string;
}

export interface ProjectMachineSetupCompletion {
  hostId: string;
  source: ProjectSource;
}

interface ProjectMachineSetupSheetProps {
  controller: SheetController;
  /** Null keeps the sheet empty (it can stay mounted). */
  target: ProjectMachineSetupTarget | null;
  /** Let the user type a clone URL when the project has no git remote. */
  allowRemoteUrlEntry?: boolean;
  /** Sheet title override (defaults to "Set up <project> on <machine>"). */
  title?: string;
  /** Fires after the source is created (source queries already invalidated). */
  onComplete: (completion: ProjectMachineSetupCompletion) => void;
}

type SetupOption = "clone" | "folder";

/**
 * Guided one-time "Set up <project> on <machine>" flow (mirrors the web
 * ProjectMachineSetupDialog): clone from the project remote onto the target
 * daemon, or point at a checkout that already exists there.
 */
export function ProjectMachineSetupSheet({
  controller,
  target,
  allowRemoteUrlEntry = false,
  title,
  onComplete,
}: ProjectMachineSetupSheetProps) {
  const maxHeight = usePickerSheetMaxHeight();
  const targetKey = target ? `${target.projectId}:${target.hostId}` : "none";
  return (
    <Sheet
      controller={controller}
      title={
        title ??
        (target
          ? `Set up ${target.projectName} on ${target.hostName}`
          : "Set up")
      }
      layout="scroll"
      maxDynamicContentSize={maxHeight}
    >
      {target ? (
        <SetupBody
          key={targetKey}
          target={target}
          allowRemoteUrlEntry={allowRemoteUrlEntry}
          controller={controller}
          onComplete={onComplete}
          testID="machine-setup"
        />
      ) : (
        <View className="h-24" />
      )}
    </Sheet>
  );
}

interface SetupBodyProps {
  target: ProjectMachineSetupTarget;
  allowRemoteUrlEntry: boolean;
  controller: SheetController;
  onComplete: (completion: ProjectMachineSetupCompletion) => void;
  testID: string;
}

function SetupBody({
  target,
  allowRemoteUrlEntry,
  controller,
  onComplete,
  testID,
}: SetupBodyProps) {
  const hasRemote = target.gitRemoteUrl !== null;
  const canClone = hasRemote || allowRemoteUrlEntry;
  const [option, setOption] = useState<SetupOption>(
    hasRemote ? "clone" : "folder",
  );
  const [remoteUrl, setRemoteUrl] = useState(target.gitRemoteUrl ?? "");
  const [customClonePath, setCustomClonePath] = useState<string | null>(null);
  const [clonePathDraft, setClonePathDraft] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const addSource = useAddProjectSource();
  const defaultClonePath = useHostCloneDefaultPath(
    target.hostId,
    target.projectId,
    { enabled: canClone },
  );
  const clonePath = customClonePath ?? defaultClonePath.data ?? null;
  const pending = addSource.isPending;

  const selectOption = (next: SetupOption) => {
    if (pending || next === option) return;
    setOption(next);
    setValidationMessage(null);
    setClonePathDraft(null);
    addSource.reset();
  };

  const commitClonePathEdit = () => {
    const normalized = normalizeProjectPathInput(clonePathDraft ?? "");
    setClonePathDraft(null);
    if (!normalized) return;
    setCustomClonePath(normalized);
    setValidationMessage(null);
    addSource.reset();
  };

  const submit = () => {
    if (pending) return;
    setValidationMessage(null);
    if (option === "clone") {
      if (customClonePath !== null) {
        const message = getProjectPathValidationMessage(customClonePath);
        if (message) {
          setValidationMessage(message);
          return;
        }
      }
      addSource.mutate(
        {
          projectId: target.projectId,
          source: {
            type: "clone",
            hostId: target.hostId,
            ...(customClonePath !== null
              ? { targetPath: customClonePath }
              : {}),
          },
        },
        {
          onSuccess: (source) => {
            controller.dismiss();
            onComplete({ hostId: target.hostId, source });
          },
        },
      );
      return;
    }
    if (folderPath === null) {
      setValidationMessage("Choose a folder.");
      return;
    }
    addSource.mutate(
      {
        projectId: target.projectId,
        source: { type: "local_path", hostId: target.hostId, path: folderPath },
      },
      {
        onSuccess: (source) => {
          controller.dismiss();
          onComplete({ hostId: target.hostId, source });
        },
      },
    );
  };

  const errorMessage = addSource.isError
    ? describeRequestError(
        addSource.error,
        `Couldn't set up ${target.projectName} on ${target.hostName}.`,
      )
    : null;
  const isTargetNotEmpty =
    addSource.error instanceof BbHttpError &&
    addSource.error.code === "target_not_empty";
  const submitDisabled =
    pending ||
    (option === "clone"
      ? clonePath === null || (!hasRemote && remoteUrl.trim().length === 0)
      : folderPath === null);

  return (
    <View className="gap-3 px-4 pb-2 pt-3">
      <Text variant="caption">
        {canClone
          ? `${target.hostName} doesn't have this project yet. Pick how to get it there — this happens once.`
          : `${target.hostName} doesn't have this project yet. Point at the project folder on ${target.hostName} — this happens once.`}
      </Text>
      {canClone ? (
        <View className="gap-2">
          <SetupOptionCard
            selected={option === "clone"}
            disabled={pending}
            onSelect={() => selectOption("clone")}
            title={
              hasRemote ? "Clone from the project remote" : "Clone a repository"
            }
            testID={`${testID}-option-clone`}
          >
            {hasRemote ? (
              <Text variant="caption" numberOfLines={2}>
                {target.gitRemoteUrl}
              </Text>
            ) : option === "clone" ? (
              <SheetInput
                value={remoteUrl}
                onChangeText={(next) => {
                  setRemoteUrl(next);
                  setValidationMessage(null);
                }}
                placeholder="https://github.com/org/repo.git"
                autoCapitalize="none"
                keyboardType="url"
                mono
                className="h-9 text-sm"
                editable={!pending}
                accessibilityLabel="Repository URL"
                testID={`${testID}-remote-url`}
              />
            ) : (
              <Text variant="caption">Enter a repository URL to clone.</Text>
            )}
            {option === "clone" ? (
              clonePathDraft !== null ? (
                <View className="flex-row items-center gap-1">
                  <SheetInput
                    value={clonePathDraft}
                    onChangeText={setClonePathDraft}
                    placeholder={defaultClonePath.data ?? "/path/to/checkout"}
                    autoCapitalize="none"
                    mono
                    className="h-9 flex-1 text-sm"
                    editable={!pending}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={commitClonePathEdit}
                    accessibilityLabel="Clone destination"
                    testID={`${testID}-clone-path-input`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    icon="Check"
                    accessibilityLabel="Use this destination"
                    disabled={pending}
                    onPress={commitClonePathEdit}
                    className="h-9 w-9"
                  />
                </View>
              ) : (
                <View className="flex-row flex-wrap items-center gap-1">
                  <Text variant="caption">into</Text>
                  <Text
                    variant="mono"
                    className="shrink text-xs"
                    numberOfLines={2}
                  >
                    {clonePath ?? "…"}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={pending}
                    onPress={() => setClonePathDraft(clonePath ?? "")}
                    hitSlop={6}
                    testID={`${testID}-clone-path-edit`}
                  >
                    <Text variant="caption" tone="primary">
                      change
                    </Text>
                  </Pressable>
                </View>
              )
            ) : null}
          </SetupOptionCard>
          <SetupOptionCard
            selected={option === "folder"}
            disabled={pending}
            onSelect={() => selectOption("folder")}
            title={`Use an existing folder on ${target.hostName}`}
            testID={`${testID}-option-folder`}
          >
            <Text variant="caption">
              Browse {target.hostName}'s files and point at a checkout you
              already have.
            </Text>
          </SetupOptionCard>
        </View>
      ) : null}
      {option === "folder" ? (
        <RemotePathBrowser
          hostId={target.hostId}
          onDirectoryChange={(directory) => {
            setFolderPath(directory);
            setValidationMessage(null);
          }}
          disabled={pending}
          inSheet
          testID={`${testID}-browser`}
        />
      ) : null}
      {pending && option === "clone" ? (
        <View className="flex-row items-center gap-2">
          <Spinner />
          <Text variant="caption">
            Cloning onto {target.hostName}… This can take a while.
          </Text>
        </View>
      ) : null}
      {validationMessage ? (
        <Text variant="caption" tone="destructive">
          {validationMessage}
        </Text>
      ) : null}
      {errorMessage ? (
        <View className="gap-1 rounded-md border border-surface-destructive-border bg-surface-destructive px-3 py-2">
          <Text variant="caption" tone="destructive">
            {errorMessage}
          </Text>
          {isTargetNotEmpty ? (
            <Text variant="caption">
              Pick a different destination, or use the existing-folder option to
              point at what's already there.
            </Text>
          ) : null}
        </View>
      ) : null}
      <View className="flex-row justify-end gap-2 pt-1">
        <Button
          variant="ghost"
          disabled={pending}
          onPress={controller.dismiss}
          testID={`${testID}-cancel`}
        >
          Cancel
        </Button>
        <Button
          disabled={submitDisabled}
          loading={pending}
          onPress={submit}
          testID={`${testID}-submit`}
        >
          {option === "clone" ? "Clone & continue" : "Use folder & continue"}
        </Button>
      </View>
    </View>
  );
}

interface SetupOptionCardProps {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  title: string;
  children: ReactNode;
  testID?: string;
}

function SetupOptionCard({
  selected,
  disabled,
  onSelect,
  title,
  children,
  testID,
}: SetupOptionCardProps) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onSelect}
      testID={testID}
      className={cn(
        "flex-row items-start gap-3 rounded-md border p-3",
        selected ? "border-primary" : "border-border",
      )}
    >
      <View
        className="mt-0.5 h-4 w-4 items-center justify-center rounded-full border"
        style={{
          borderColor: selected ? tokens.primary : tokens.mutedForeground,
        }}
      >
        {selected ? (
          <View
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: tokens.primary }}
          />
        ) : null}
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text variant="label">{title}</Text>
        {children}
      </View>
    </Pressable>
  );
}

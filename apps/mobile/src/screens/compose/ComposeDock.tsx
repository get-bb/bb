import type { Host } from "@bb/domain";
import type { ThreadResponse } from "@bb/server-contract";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { Composer, type ComposerAction, type ComposerHandle } from "@/composer";
import { useSidebarBootstrap } from "@/data/sidebar";
import { useTheme } from "@/theme";
import { Icon, Text, toast, useSheet } from "@/ui";
import { ProjectWorkspacePanelProvider, usePanel } from "../panel";
import {
  BranchPicker,
  EnvironmentPicker,
  HostPicker,
  PathPicker,
  ProjectPicker,
} from "../pickers";
import {
  ProjectMachineSetupSheet,
  type ProjectMachineSetupTarget,
} from "../projects/ProjectMachineSetupSheet";
import { newProjectHref } from "../shell/hrefs";
import { composeExecutionControls } from "./ExecutionControlsRow";
import type { ComposeController } from "./useComposeController";

interface ComposeDockProps {
  controller: ComposeController;
  /** Pill ↔ card transitions (the home screen drives its scrim). */
  onExpandedChange?: (expanded: boolean) => void;
  composerRef?: React.RefObject<ComposerHandle | null>;
  /** Called with the created thread; the caller navigates or toasts. */
  onCreated: (thread: ThreadResponse) => void;
  testID?: string;
}

/**
 * The new-thread composer docked under the home list: the shared composer
 * as a one-line pill that expands on focus into the card with the
 * where-it-runs pickers (project, environment, machine, branch, folder) on
 * the top row, the agent pickers (provider, model + reasoning, permissions)
 * on the footer row, a "Workspace" entry in the "+" menu, and Create as the
 * submit. Inside the root-compose workspace panel provider so the panel can
 * show project files and a machine terminal before the thread exists.
 */
export function ComposeDock(props: ComposeDockProps) {
  const { controller } = props;
  return (
    <ProjectWorkspacePanelProvider
      projectId={controller.projectId || null}
      environmentId={
        controller.environment.type === "reuse"
          ? controller.environment.environmentId
          : null
      }
      hostId={controller.selectedHost?.id ?? null}
    >
      <ComposeDockBody {...props} />
    </ProjectWorkspacePanelProvider>
  );
}

function ComposeDockBody({
  controller,
  onExpandedChange,
  composerRef,
  onCreated,
  testID = "compose",
}: ComposeDockProps) {
  const router = useRouter();
  const panel = usePanel();
  const setupSheet = useSheet();
  const [setupTarget, setSetupTarget] =
    useState<ProjectMachineSetupTarget | null>(null);
  const sectionName = useSectionName(controller.sectionId);

  const requestMachineSetup = useCallback(
    (host: Host) => {
      const project = controller.project;
      if (!project) return;
      setSetupTarget({
        projectId: project.id,
        projectName: project.name,
        gitRemoteUrl: project.gitRemoteUrl,
        hostId: host.id,
        hostName: host.name,
      });
      setupSheet.present();
    },
    [controller.project, setupSheet],
  );

  const onSubmit = async () => {
    if (!controller.canSubmit) {
      if (controller.submitBlockerMessage) {
        toast.warning(controller.submitBlockerMessage);
      }
      return;
    }
    try {
      const thread = await controller.submit();
      if (thread) onCreated(thread);
    } catch {
      // The profile QueryClient's mutation error toast already reported it.
    }
  };

  const openPanel = panel.open;
  const composerActions = useMemo<ComposerAction[]>(
    () => [
      {
        key: "workspace",
        label: "Workspace",
        icon: "PanelBottom",
        onPress: () => openPanel(),
      },
    ],
    [openPanel],
  );

  const hint =
    controller.forkSeed !== null
      ? {
          text: `Forking from ${controller.forkSeed.sourceThreadTitle}`,
          testID: "compose-fork-hint",
        }
      : sectionName
        ? {
            text: `Filing under ${sectionName}`,
            testID: "compose-section-hint",
          }
        : null;

  return (
    <>
      <Composer
        ref={composerRef}
        value={controller.value}
        onChange={controller.setValue}
        attachments={controller.attachments}
        onAttachmentsChange={controller.setAttachments}
        scope={{
          projectId: controller.projectId || null,
          providerId: controller.providerId || null,
          environmentId:
            controller.environment.type === "reuse"
              ? controller.environment.environmentId
              : null,
          hostId: controller.selectedHost?.id ?? null,
        }}
        submitMode="ready"
        submitLabel="Create"
        onSubmit={() => void onSubmit()}
        isSubmitting={controller.isSubmitting}
        placeholder="Plan, ask, build…"
        actions={composerActions}
        executionControls={composeExecutionControls(controller, {
          disabled: controller.isSubmitting,
        })}
        topControls={
          <WhereControls
            controller={controller}
            onCreateProject={() => router.push(newProjectHref())}
            onRequestMachineSetup={requestMachineSetup}
            disabled={controller.isSubmitting}
          />
        }
        header={
          hint ? (
            <ComposeHint testID={hint.testID}>{hint.text}</ComposeHint>
          ) : null
        }
        collapsible
        onExpandedChange={onExpandedChange}
        minInputHeight={88}
        typeaheadPlacement="above"
        testID={testID}
      />
      <ProjectMachineSetupSheet
        controller={setupSheet}
        target={setupTarget}
        onComplete={({ hostId, source }) => {
          controller.setEnvironment({
            type: "host",
            hostId,
            workspace: { type: "unmanaged", path: null, branch: null },
          });
          toast.success("Project set up", {
            description: `${setupTarget?.hostName ?? "Machine"}: ${source.path}`,
          });
        }}
      />
    </>
  );
}

function ComposeHint({
  children,
  testID,
}: {
  children: ReactNode;
  testID: string;
}) {
  const { tokens } = useTheme();
  return (
    <View className="flex-row items-center gap-2 border-b border-border-hairline px-3 py-1.5">
      <Icon name="Fork" size={14} color={tokens.mutedForeground} />
      <Text
        variant="caption"
        className="min-w-0 flex-1"
        numberOfLines={1}
        testID={testID}
      >
        {children}
      </Text>
    </View>
  );
}

/**
 * The "where it runs" row above the prompt: project, then the environment
 * mode and the machine / branch / folder pickers that mode needs.
 */
function WhereControls({
  controller: c,
  onCreateProject,
  onRequestMachineSetup,
  disabled,
}: {
  controller: ComposeController;
  onCreateProject: () => void;
  onRequestMachineSetup: (host: Host) => void;
  disabled: boolean;
}) {
  const showHostPicker = c.hosts.length > 1 && c.environment.type !== "reuse";
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 2, alignItems: "center" }}
      style={{ flexGrow: 1, flexShrink: 1 }}
      testID="compose-environment-controls"
    >
      <ProjectPicker
        projects={c.projects}
        personalProject={c.personalProject}
        value={c.projectId}
        onChange={c.selectProject}
        onCreateProject={onCreateProject}
        disabled={disabled}
        loading={c.projectsLoading}
      />
      <EnvironmentPicker
        value={c.environment}
        onChange={c.setEnvironment}
        host={c.selectedHost}
        hostHasSource={c.hostHasSource}
        isPersonalProject={c.isPersonalProject}
        reuseOptions={c.reuseOptions}
        reuseOptionsLoading={c.reuseOptionsLoading}
        worktreeDisabledReason={c.worktreeDisabledReason}
        disabled={disabled}
      />
      {showHostPicker ? (
        <HostPicker
          hosts={c.hosts}
          value={c.environment.type === "host" ? c.environment.hostId : null}
          onChange={c.selectHost}
          hostIdsWithSource={c.hostIdsWithSource}
          primaryHostId={c.primaryHostId}
          onRequestSetup={onRequestMachineSetup}
          disabled={disabled}
        />
      ) : null}
      {c.branch ? (
        <BranchPicker
          mode={c.branch.mode}
          branches={c.branch.branches}
          remoteBranches={c.branch.remoteBranches}
          selected={c.branch.selected}
          defaultBranch={c.branch.defaultBranch}
          searchQuery={c.branch.searchQuery}
          onSearchQueryChange={c.branch.setSearchQuery}
          isLoading={c.branch.isLoading}
          onSelect={c.branch.select}
          onClear={c.branch.clear}
          onCreateFrom={
            c.branch.mode === "local" ? c.branch.createFrom : undefined
          }
          disabled={disabled}
        />
      ) : null}
      {c.hostMode === "local" ? (
        <PathPicker
          hostId={c.selectedHost?.id ?? null}
          hostName={c.selectedHost?.name ?? null}
          defaultPath={c.defaultWorkspacePath}
          value={c.workspacePath}
          onChange={c.setWorkspacePath}
          disabled={disabled}
        />
      ) : null}
    </ScrollView>
  );
}

/** The section's display name from the sidebar cache (manual-organize mode). */
function useSectionName(sectionId: string | null): string | null {
  const { data } = useSidebarBootstrap({ enabled: sectionId !== null });
  if (sectionId === null) return null;
  return (
    data?.sections.find((section) => section.id === sectionId)?.name ?? null
  );
}

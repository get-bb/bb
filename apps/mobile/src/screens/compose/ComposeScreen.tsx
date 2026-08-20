import type { Host } from "@bb/domain";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProfiles } from "@/app-shell";
import { useSidebarBootstrap } from "@/data/sidebar";
import { Composer } from "@/composer";
import {
  Button,
  Input,
  KeyboardPaddingView,
  Switch,
  Text,
  toast,
  useSheet,
} from "@/ui";
import { ProjectWorkspacePanelProvider, usePanel } from "../panel";
import {
  ProjectMachineSetupSheet,
  type ProjectMachineSetupTarget,
} from "../projects/ProjectMachineSetupSheet";
import { newProjectHref, threadHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";
import {
  composeExecutionControls,
  EnvironmentControlsRow,
} from "./ExecutionControlsRow";
import {
  useComposeController,
  type ComposeParams,
} from "./useComposeController";

function firstParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * `/compose?projectId=&sectionId=&initialPrompt=&reuseEnvironmentId=`: the
 * root new-thread screen. The shared composer (mentions, attachments,
 * voice, "+" actions, agent pills), an optional title, the environment
 * pills, and Create (the composer's submit).
 */
export function ComposeScreen() {
  const params = useLocalSearchParams<{
    projectId?: string | string[];
    sectionId?: string | string[];
    initialPrompt?: string | string[];
    reuseEnvironmentId?: string | string[];
    forkSourceThreadId?: string | string[];
    forkSourceSeqEnd?: string | string[];
    forkSourceThreadTitle?: string | string[];
    handoffSourceThreadId?: string | string[];
    handoffSourceThreadTitle?: string | string[];
  }>();
  const composeParams: ComposeParams = {
    projectId: firstParam(params.projectId),
    sectionId: firstParam(params.sectionId),
    initialPrompt: firstParam(params.initialPrompt),
    reuseEnvironmentId: firstParam(params.reuseEnvironmentId),
    // Thread seeds (see @/data/compose compose-seed-params): fork from a
    // message, handoff from the context banner.
    forkSourceThreadId: firstParam(params.forkSourceThreadId),
    forkSourceSeqEnd: firstParam(params.forkSourceSeqEnd),
    forkSourceThreadTitle: firstParam(params.forkSourceThreadTitle),
    handoffSourceThreadId: firstParam(params.handoffSourceThreadId),
    handoffSourceThreadTitle: firstParam(params.handoffSourceThreadTitle),
  };
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <Screen testID="compose-screen">
        <Text variant="title">New thread</Text>
        <Text variant="caption">Add a server first to start threads.</Text>
      </Screen>
    );
  }
  return <ConnectedComposeScreen params={composeParams} />;
}

function ConnectedComposeScreen({ params }: { params: ComposeParams }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const controller = useComposeController(params);
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
      if (!thread) return;
      if (controller.navigateAfterCreate) {
        router.replace(threadHref(thread.id));
      } else {
        toast.success("Thread created", {
          description: thread.title ?? undefined,
          action: {
            label: "Open",
            onClick: () => router.push(threadHref(thread.id)),
          },
        });
      }
    } catch {
      // The profile QueryClient's mutation error toast already reported it.
    }
  };

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
      <Screen scroll={false} testID="compose-screen">
        <KeyboardPaddingView style={{ flex: 1 }}>
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16, gap: 12 }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          >
            {sectionName ? (
              <Text variant="caption" testID="compose-section-hint">
                Filing under {sectionName}
              </Text>
            ) : null}
            {controller.forkSeed ? (
              <Text variant="caption" testID="compose-fork-hint">
                Forking from {controller.forkSeed.sourceThreadTitle}
              </Text>
            ) : null}
            <Input
              value={controller.title}
              onChangeText={controller.setTitle}
              placeholder="Title (optional)"
              returnKeyType="next"
              editable={!controller.isSubmitting}
              testID="compose-title-input"
            />
            {controller.modelLoadErrorMessage ? (
              <Text variant="caption" tone="warning">
                {controller.modelLoadErrorMessage}
              </Text>
            ) : null}
          </ScrollView>
          <View
            className="gap-3 border-t border-border-hairline bg-background pt-3"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            <View className="px-3">
              <Composer
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
                executionControls={composeExecutionControls(controller, {
                  onCreateProject: () => router.push(newProjectHref()),
                  disabled: controller.isSubmitting,
                })}
                autoFocus={!params.initialPrompt}
                testID="compose"
              />
            </View>
            <EnvironmentControlsRow
              controller={controller}
              onRequestMachineSetup={requestMachineSetup}
              disabled={controller.isSubmitting}
            />
            <View className="flex-row items-center gap-2 px-4">
              <Switch
                size="sm"
                checked={controller.navigateAfterCreate}
                onCheckedChange={controller.setNavigateAfterCreate}
                testID="compose-navigate-toggle"
              />
              <Text variant="caption" numberOfLines={1} className="shrink">
                Open after creating
              </Text>
              <View className="flex-1" />
              <ComposeWorkspaceButton />
            </View>
          </View>
        </KeyboardPaddingView>
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
      </Screen>
    </ProjectWorkspacePanelProvider>
  );
}

/**
 * Opens the root-compose workspace panel (project files + a terminal on the
 * selected machine) before the thread exists.
 */
function ComposeWorkspaceButton() {
  const panel = usePanel();
  return (
    <Button
      variant="ghost"
      size="sm"
      icon="PanelBottom"
      onPress={() => panel.open()}
      testID="compose-workspace-button"
    >
      Workspace
    </Button>
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

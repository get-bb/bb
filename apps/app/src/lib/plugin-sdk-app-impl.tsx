import {
  LazyPluginMarkdown,
  LazyPluginDiff,
  LazyPluginSourceCode,
} from "@/components/plugin/lazy-plugin-renderers";
import { ProviderIcon } from "@/components/plugin/ProviderIcon";
import { Icon } from "@bb/shared-ui/icon";
import type {
  ExperimentalInfoListRowProps,
  PluginSdkApp,
} from "@get-bb/plugin-sdk";
import { PluginBranchPicker } from "@/components/plugin/PluginBranchPicker";
import {
  usePluginBranches,
  usePluginCheckoutState,
} from "@/components/plugin/usePluginBranchPickerState";
import { PluginNewThreadComposer } from "@/components/plugin/PluginNewThreadComposer";
import { useComposerRendererApi } from "@/components/promptbox/ComposerBox";
import {
  ComposerRoot,
  useComposerContributions,
} from "@/components/promptbox/composer-root";
import {
  useComposerCommandSearch,
  useComposerMentionSearch,
} from "@/components/promptbox/composer-search";
import { VoiceInputButton } from "@/components/promptbox/VoiceInputButton";
import { VoiceRecordingBar } from "@/components/promptbox/VoiceRecordingBar";
import { FailedVoiceRecordings } from "@/components/promptbox/FailedVoiceRecordings";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { ComposerMentionIcon } from "@/components/promptbox/mentions/PromptMentionIcon";
import {
  describePromptMention,
  promptMentionClipboardAttributes,
  readPromptMentionClipboard,
} from "@/components/promptbox/mentions/prompt-mention-pill";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  ThreadTitle as ThreadTitleText,
  useThreadTitleDisplayText,
} from "@/components/thread/ThreadTitleMentions";
import { VoiceInputTextarea } from "@/components/promptbox/VoiceInputTextarea";
import { PluginProviderModelPicker } from "@/components/plugin/PluginProviderModelPicker";
import { PluginPermissionModePicker } from "@/components/plugin/PluginPermissionModePicker";
import { LazyPluginThreadChat } from "@/components/plugin/LazyPluginThreadChat";
import { PluginThreadTitle } from "@/components/plugin/PluginThreadTitle";
import { ThreadStatusGlyph } from "@/components/thread/ThreadStatusGlyph";
import { PluginUrlLink } from "@/components/plugin/PluginUrlLink";
import { ExperimentalFileLink } from "@/components/plugin/ExperimentalFileLink";
import { usePluginId } from "@/components/plugin/plugin-context";
import { useQuestionFormHost } from "@bb/shared-ui/question-form-host";
import { definePluginApp } from "./plugin-app-definition";
import {
  useBbContext,
  useBbNavigate,
  useComposer,
  useComposers,
  useComposerView,
  useEnvironmentProviders,
  useProviders,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  experimental_useRpcQuery,
  experimental_useRpcKeyedQuery,
  experimental_useRpcMutation,
  experimental_useRpcRefresh,
  useSdk,
  useSettings,
  experimental_useAppPanel,
  experimental_useFixedTabTarget,
} from "./plugin-sdk-hooks";
import {
  useSidebarThreadActions,
  useSidebarThreadDraft,
  useSidebarThreadDraftIds,
  useSidebarThreadPullRequest,
  useSidebarThreadRowStatus,
  useSidebarThreadRowStatuses,
  useSidebarThreadShortcut,
  useSidebarThreads,
} from "./plugin-sidebar-hooks";
import {
  useSidebarSplitLayout,
  useSidebarThreadSplit,
} from "./plugin-sidebar-split";
import { useExperiment } from "./plugin-experiments";
import {
  experimental_PluginRpcCallError,
  experimental_THREAD_ACTION_GROUPS,
  experimental_THREAD_CONTEXT_SEGMENT_GROUPS,
  experimental_THREAD_INFO_ROW_GROUPS,
  experimental_THREAD_INFO_SECTION_GROUPS,
} from "@get-bb/plugin-sdk";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "@/components/thread/ThreadActionsMenu";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import {
  useThreadActionEntries,
  useThreadActionRegistrationInfos,
} from "./thread-actions/thread-action-registry";
import { useCodeTheme } from "./plugin-code-theme";
import { copyToClipboard } from "./clipboard";
import { saveFile } from "./save-file";
import {
  useSidebarNavigation,
  useSidebarNavigationSplit,
} from "./plugin-sidebar-navigation";
import { SidebarNavigationIcon } from "@/components/sidebar/SidebarNavigationModel";
import {
  InfoList,
  InfoListRow,
  InfoSection,
} from "@/components/secondary-panel/info/info-list";
import { DetailRow } from "@/components/ui/detail-card";

function PluginInfoListRow({
  onSelect,
  ...props
}: ExperimentalInfoListRowProps) {
  return (
    <InfoListRow
      {...props}
      target={onSelect === undefined ? null : { kind: "button", onSelect }}
    />
  );
}

function useArchiveEnvironmentThreads(): (
  environmentId: string,
) => Promise<void> {
  return useThreadActions().archiveEnvironmentThreads;
}

export const pluginSdkAppImplementation = {
  definePluginApp,
  experimental_Icon: Icon,
  experimental_ProviderIcon: ProviderIcon,
  useBbContext,
  experimental_usePluginId: usePluginId,
  experimental_useQuestionFormHost: useQuestionFormHost,
  useBbNavigate,
  experimental_useAppPanel,
  experimental_useFixedTabTarget,
  useComposer,
  useComposers,
  experimental_useComposerRenderer: useComposerRendererApi,
  experimental_useThreadTitleDisplayText: useThreadTitleDisplayText,
  experimental_useComposerContributions: useComposerContributions,
  experimental_useComposerMentionSearch: useComposerMentionSearch,
  experimental_useComposerCommandSearch: useComposerCommandSearch,
  experimental_ComposerRoot: ComposerRoot,
  experimental_VoiceInputButton: VoiceInputButton,
  experimental_VoiceRecordingBar: VoiceRecordingBar,
  experimental_FailedVoiceRecordings: FailedVoiceRecordings,
  experimental_ShortcutHint: AppCommandShortcutHint,
  experimental_ImageLightbox: ImageLightbox,
  experimental_PromptMentionIcon: ComposerMentionIcon,
  experimental_describePromptMention: describePromptMention,
  experimental_promptMentionClipboardAttributes:
    promptMentionClipboardAttributes,
  experimental_readPromptMentionClipboard: readPromptMentionClipboard,
  experimental_PluginIcon: PluginIcon,
  experimental_ThreadTitleText: ThreadTitleText,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  experimental_useRpcQuery,
  experimental_useRpcKeyedQuery,
  experimental_useRpcMutation,
  experimental_useRpcRefresh,
  useSettings,
  ThreadChat: LazyPluginThreadChat,
  Markdown: LazyPluginMarkdown,
  experimental_FileLink: ExperimentalFileLink,
  UrlLink: PluginUrlLink,
  experimental_NewThreadComposer: PluginNewThreadComposer,
  experimental_VoiceInputTextarea: VoiceInputTextarea,
  experimental_ProviderModelPicker: PluginProviderModelPicker,
  experimental_PermissionModePicker: PluginPermissionModePicker,
  experimental_BranchPicker: PluginBranchPicker,
  experimental_useBranches: usePluginBranches,
  experimental_useCheckoutState: usePluginCheckoutState,
  experimental_SourceCode: LazyPluginSourceCode,
  experimental_Diff: LazyPluginDiff,
  experimental_InfoSection: InfoSection,
  experimental_DetailRow: DetailRow,
  experimental_InfoList: InfoList,
  experimental_InfoListRow: PluginInfoListRow,
  experimental_useSidebarThreads: useSidebarThreads,
  experimental_useSidebarThreadActions: useSidebarThreadActions,
  experimental_useThreadActions: useThreadActionEntries,
  experimental_useArchiveEnvironmentThreads: useArchiveEnvironmentThreads,
  experimental_useThreadActionRegistrations: useThreadActionRegistrationInfos,
  experimental_ThreadActionsMenu: ThreadActionsMenu,
  experimental_ThreadActionsContextMenu: ThreadActionsContextMenu,
  experimental_PluginRpcCallError,
  experimental_THREAD_ACTION_GROUPS,
  experimental_THREAD_CONTEXT_SEGMENT_GROUPS,
  experimental_THREAD_INFO_ROW_GROUPS,
  experimental_THREAD_INFO_SECTION_GROUPS,
  experimental_useSidebarThreadSplit: useSidebarThreadSplit,
  experimental_useExperiment: useExperiment,
  experimental_useSidebarNavigation: useSidebarNavigation,
  experimental_useSidebarNavigationSplit: useSidebarNavigationSplit,
  experimental_SidebarNavigationIcon: SidebarNavigationIcon,
  useSidebarThreadDraft,
  useSidebarThreadDraftIds,
  useSidebarThreadRowStatus,
  useSidebarThreadRowStatuses,
  useSidebarSplitLayout,
  useSidebarThreadShortcut,
  ThreadTitle: PluginThreadTitle,
  experimental_ThreadStatusGlyph: ThreadStatusGlyph,
  useEnvironmentProviders,
  useSdk,
  experimental_useProviders: useProviders,
  experimental_useCodeTheme: useCodeTheme,
  experimental_copyToClipboard: copyToClipboard,
  experimental_saveFile: saveFile,
} satisfies PluginSdkApp;

export const retiredPluginSdkAppMembers = {
  experimental_useSidebarThreadPullRequest: useSidebarThreadPullRequest,
};

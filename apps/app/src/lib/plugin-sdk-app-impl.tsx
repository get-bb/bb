import { useCallback, useMemo } from "react";
import type { MarkdownProps, PluginSdkApp } from "@get-bb/plugin-sdk";
import { PluginDiff } from "@/components/plugin/PluginDiff";
import { PluginNewThreadComposer } from "@/components/plugin/PluginNewThreadComposer";
import { PluginSourceCode } from "@/components/plugin/PluginSourceCode";
import { PluginThreadChat } from "@/components/plugin/PluginThreadChat";
import { ExperimentalUrlLink } from "@/components/plugin/ExperimentalUrlLink";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import type {
  MarkdownLinkRouting,
  MarkdownLocalFileLinkRouting,
} from "@/components/ui/markdown-link-routing";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import { useThreadTimelineNavigation } from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { definePluginApp } from "./plugin-app-definition";
import {
  useBbContext,
  useBbNavigate,
  useComposer,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings,
} from "./plugin-sdk-hooks";
import {
  useSidebarThreadActions,
  useSidebarThreadPullRequest,
  useSidebarThreads,
} from "./plugin-sidebar-hooks";
import { useSidebarThreadSplit } from "./plugin-sidebar-split";
import { useAppNavigationHost } from "./app-navigation-host";

/**
 * The real `@get-bb/plugin-sdk/app` surface (plugin design §5.2), assigned to
 * `globalThis.__bbPluginRuntime.pluginSdkApp` by installPluginRuntime() so
 * `bb plugin build` shims resolve it inside plugin bundles. `satisfies
 * PluginSdkApp` keeps it in type-sync with the facade package; the plugin SDK
 * parity test compares the facade's actual runtime exports with its bundled
 * declarations so declaration-only values cannot leak into the contract.
 *
 * Deliberately hooks-only (the 65-component host-provided UI kit was removed
 * 2026-07-03, plugin design §5.5): plugins vendor shadcn-style component
 * source from the BB registry and own it; the shared-singleton packages
 * (portal radix families, sonner, vaul) reach plugins through their own
 * runtime shims in plugin-frontend.ts, so `import { toast } from "sonner"`
 * hits the host toaster without an SDK member.
 */
export const pluginSdkAppImplementation = {
  definePluginApp,
  useBbContext,
  useBbNavigate,
  useComposer,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings,
  // The host-owned components in the SDK (plugin design: deliberate
  // exception to §5.5) — stable product capabilities, not a UI kit.
  ThreadChat: PluginThreadChat,
  Markdown: PluginMarkdown,
  experimental_UrlLink: ExperimentalUrlLink,
  // Experimental (see docs/api_to_audit.md): the create-side counterpart to
  // ThreadChat.
  experimental_NewThreadComposer: PluginNewThreadComposer,
  // Experimental (see docs/api_to_audit.md): the host-owned code renderers.
  // Both resolve any active plugin replacement, so first-party surfaces and
  // plugins share one boundary.
  experimental_SourceCode: PluginSourceCode,
  experimental_Diff: PluginDiff,
  // Experimental (see docs/api_to_audit.md): the sidebar thread-list data
  // plane, for plugins that replace the list itself.
  experimental_useSidebarThreads: useSidebarThreads,
  experimental_useSidebarThreadActions: useSidebarThreadActions,
  experimental_useSidebarThreadPullRequest: useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit: useSidebarThreadSplit,
} satisfies PluginSdkApp;

/**
 * The public chat-message markdown renderer: the host's MarkdownPreview with
 * only the stable content/className surface exposed. Renderer options
 * (lightbox, link routing, thread mentions) stay host-internal.
 */
function PluginMarkdown({ content, className }: MarkdownProps) {
  const timelineNavigation = useThreadTimelineNavigation();
  const onOpenLocalFileLink = timelineNavigation?.onOpenLocalFileLink;
  const workspaceRootPath = timelineNavigation?.workspaceRootPath;
  const navigation = useAppNavigationHost();
  const onOpenLink = useCallback<MarkdownPreviewLinkHandler>(
    ({ href }) => navigation.openUrl({ url: href }),
    [navigation],
  );
  const linkRouting = useMemo<MarkdownLinkRouting>(() => {
    if (onOpenLocalFileLink === undefined) {
      return { onOpenLink };
    }
    const localFile: MarkdownLocalFileLinkRouting = {
      absoluteLinks: { kind: "trusted-host" },
      onOpenLink: onOpenLocalFileLink,
    };
    if (workspaceRootPath !== undefined) {
      localFile.relativeLinks = {
        baseDir: workspaceRootPath,
        rootPath: workspaceRootPath,
      };
    }
    return { localFile, onOpenLink };
  }, [onOpenLink, onOpenLocalFileLink, workspaceRootPath]);

  return (
    <MarkdownPreview
      content={content}
      className={className}
      linkRouting={linkRouting}
    />
  );
}

import type { PromptMentionResource, ThreadOriginKind } from "@bb/domain";
import type { InstalledPlugin } from "@bb/server-contract";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { usePluginList } from "@/data/plugins";
import {
  useSenderThreadMetadataById,
  type SenderThreadMetadata,
} from "@/data/thread-detail";
import { useThread } from "@/data/threads";
import type { MarkdownLinkTarget, MarkdownLocalFileLink } from "@/markdown";
import { toast, useSheet } from "@/ui";
import { useThreadLocalFileLinks } from "../../../files/use-thread-local-file-links";
import { MessageActionSheet } from "../../actions/MessageActionSheet";
import type {
  TimelineMessageActionHandlers,
  TimelineMessageActionsTarget,
} from "../../actions/message-actions-model";
import { ImageLightbox } from "../lightbox/ImageLightbox";
import {
  openLightbox,
  stepLightbox,
  type LightboxImage,
  type LightboxState,
} from "../lightbox/lightbox-model";

export type {
  TimelineMessageActionHandlers,
  TimelineMessageActionsTarget,
} from "../../actions/message-actions-model";

const NO_MESSAGE_ACTION_HANDLERS: TimelineMessageActionHandlers = {};

/**
 * Per-timeline services the row renderers reach through context instead of
 * props: the profile's server URL (attachment/image routes), the thread's
 * workspace root (relative image paths), its origin kind (fork seed icon),
 * the sender-thread metadata map, the installed-plugin list (declared row
 * icons), navigation to other threads, the single image lightbox, and the
 * long-press message action sheet. One provider per thread detail screen.
 */
interface TimelineRowHostValue {
  threadId: string;
  serverUrl: string;
  workspaceRootPath: string | undefined;
  threadOriginKind: ThreadOriginKind | null;
  senderThreadMetadataById: ReadonlyMap<string, SenderThreadMetadata>;
  /**
   * The installed-plugin list kept live for the whole timeline (one query
   * observer and one realtime subscription, not one per mounted row); a
   * work row's `"<pluginId>/<name>"` glyph resolves against it. Undefined
   * until the first fetch lands, when every such row draws its per-kind
   * glyph.
   */
  installedPlugins:
    | readonly Pick<InstalledPlugin, "id" | "icons">[]
    | undefined;
  /** Thread-mention resolver for markdown pills (title from the caches). */
  resolveThreadMention: (threadId: string) => PromptMentionResource | null;
  openThread: (threadId: string) => void;
  openImageLightbox: (images: readonly LightboxImage[], index: number) => void;
  presentMessageActions: (target: TimelineMessageActionsTarget) => void;
  /**
   * An absolute `/path[:line]` link in markdown / an attachment: opens the
   * file preview (workspace root → thread storage → host file).
   */
  openLocalFileLink: (link: MarkdownLocalFileLink) => void;
  /** Markdown `onLinkPress`: claims relative `path[:line]` references (root picker when ambiguous). */
  onMarkdownLinkPress: (link: MarkdownLinkTarget) => boolean;
}

const TimelineRowHostContext = createContext<TimelineRowHostValue | null>(null);

export function useTimelineRowHost(): TimelineRowHostValue {
  const value = useContext(TimelineRowHostContext);
  if (value === null) {
    throw new Error(
      "Timeline rows must render under <TimelineRowHostProvider>.",
    );
  }
  return value;
}

interface TimelineRowHostProviderProps {
  threadId: string;
  workspaceRootPath: string | undefined;
  threadOriginKind: ThreadOriginKind | null;
  /**
   * What the screen can do with a long-pressed message beyond copying
   * (quote into the composer, edit, fork, send to main). Omitted handlers
   * hide their action. Defaults to copy only.
   */
  messageActions?: TimelineMessageActionHandlers;
  children: ReactNode;
}

function copyMessageTextToClipboard(text: string): void {
  void Clipboard.setStringAsync(text)
    .then(() => {
      toast.success("Copied");
    })
    .catch(() => {
      toast.error("Could not copy");
    });
}

export function TimelineRowHostProvider({
  threadId,
  workspaceRootPath,
  threadOriginKind,
  messageActions = NO_MESSAGE_ACTION_HANDLERS,
  children,
}: TimelineRowHostProviderProps) {
  const { serverUrl } = useProfileClient();
  const router = useRouter();
  const senderThreadMetadataById = useSenderThreadMetadataById();
  const installedPlugins = usePluginList().data;
  // Local file links route by the thread's roots; the environment id decides
  // whether host-file reads are possible. Read from the cache only: the
  // thread screen owns the fetch, and the dev showcases have no real thread.
  const threadQuery = useThread(threadId, { enabled: false });
  const localFileLinks = useThreadLocalFileLinks({
    threadId,
    environmentId: threadQuery.data?.environmentId ?? null,
    workspaceRootPath: workspaceRootPath ?? null,
  });

  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const stepLightboxImage = useCallback(
    (direction: "previous" | "next") =>
      setLightbox((current) =>
        current === null ? current : stepLightbox(current, direction),
      ),
    [],
  );

  const actionsSheet = useSheet();
  const [actionsTarget, setActionsTarget] =
    useState<TimelineMessageActionsTarget | null>(null);
  const presentMessageActions = useCallback(
    (target: TimelineMessageActionsTarget) => {
      setActionsTarget(target);
      actionsSheet.present();
    },
    [actionsSheet],
  );

  const openThread = useCallback(
    (id: string) => {
      router.push({ pathname: "/threads/[id]", params: { id } });
    },
    [router],
  );

  const value = useMemo<TimelineRowHostValue>(
    () => ({
      threadId,
      serverUrl,
      workspaceRootPath,
      threadOriginKind,
      senderThreadMetadataById,
      installedPlugins,
      resolveThreadMention: (id) => {
        const title = senderThreadMetadataById.get(id)?.title ?? null;
        return title === null
          ? null
          : { kind: "thread", threadId: id, label: title };
      },
      openThread,
      openImageLightbox: (images, index) =>
        setLightbox(openLightbox(images, index)),
      presentMessageActions,
      openLocalFileLink: localFileLinks.openLocalFileLink,
      onMarkdownLinkPress: localFileLinks.onMarkdownLinkPress,
    }),
    [
      installedPlugins,
      localFileLinks.onMarkdownLinkPress,
      localFileLinks.openLocalFileLink,
      openThread,
      presentMessageActions,
      senderThreadMetadataById,
      serverUrl,
      threadId,
      threadOriginKind,
      workspaceRootPath,
    ],
  );

  return (
    <TimelineRowHostContext.Provider value={value}>
      {children}
      <ImageLightbox
        state={lightbox}
        onClose={closeLightbox}
        onStep={stepLightboxImage}
      />
      <MessageActionSheet
        controller={actionsSheet}
        target={actionsTarget}
        handlers={messageActions}
        onCopy={copyMessageTextToClipboard}
      />
      {localFileLinks.pickerSheet}
    </TimelineRowHostContext.Provider>
  );
}

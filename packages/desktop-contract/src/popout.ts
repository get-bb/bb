import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { z } from "zod";

export const BB_DESKTOP_POPOUT_ID_MAX_LENGTH = 200;
export const POPOUT_ROUTE_PATH = "/popout";
// The visible popout card. Its height when a thread is open; the quick-ask
// composer instead sizes to its content so it grows as the textarea and
// attachments expand.
export const POPOUT_CARD_WIDTH = 480;
export const POPOUT_THREAD_CARD_HEIGHT = 620;
// Transparent gutter reserved around the card on every side so its drop shadow
// renders into the (frameless, transparent) window instead of being clipped at
// the window edges.
export const POPOUT_SHADOW_MARGIN = 28;
export const POPOUT_WINDOW_WIDTH = POPOUT_CARD_WIDTH + POPOUT_SHADOW_MARGIN * 2;
export const POPOUT_WINDOW_HEIGHT =
  POPOUT_THREAD_CARD_HEIGHT + POPOUT_SHADOW_MARGIN * 2;
// Height of the loading placeholder shown before the popout renderer mounts.
export const POPOUT_QUICK_ASK_HEIGHT = 220;

export const bbDesktopPopoutThreadRefSchema = z
  .object({
    projectId: z.string().min(1).max(BB_DESKTOP_POPOUT_ID_MAX_LENGTH),
    threadId: z.string().min(1).max(BB_DESKTOP_POPOUT_ID_MAX_LENGTH),
  })
  .strict();
export type BbDesktopPopoutThreadRef = z.infer<
  typeof bbDesktopPopoutThreadRefSchema
>;

export function getDesktopThreadRoutePath(
  thread: BbDesktopPopoutThreadRef,
): string {
  return thread.projectId === PERSONAL_PROJECT_ID
    ? `/threads/${thread.threadId}`
    : `/projects/${thread.projectId}/threads/${thread.threadId}`;
}

export function getDesktopPopoutThreadRoutePath(
  thread: BbDesktopPopoutThreadRef,
): string {
  return thread.projectId === PERSONAL_PROJECT_ID
    ? `${POPOUT_ROUTE_PATH}/threads/${thread.threadId}`
    : `${POPOUT_ROUTE_PATH}/projects/${thread.projectId}/threads/${thread.threadId}`;
}

export const bbDesktopPopoutThreadChangedPayloadSchema =
  bbDesktopPopoutThreadRefSchema.nullable();
export type BbDesktopPopoutThreadChangedPayload = z.infer<
  typeof bbDesktopPopoutThreadChangedPayloadSchema
>;

export const bbDesktopPopoutMouseEventsIgnoredRequestSchema = z
  .object({
    ignore: z.boolean(),
  })
  .strict();
export type BbDesktopPopoutMouseEventsIgnoredRequest = z.infer<
  typeof bbDesktopPopoutMouseEventsIgnoredRequestSchema
>;

export type BbDesktopPopoutThreadChangedHandler = (
  payload: BbDesktopPopoutThreadChangedPayload,
) => void;
export type BbDesktopPopoutUnsubscribe = () => void;

export interface BbDesktopPopoutApi {
  getCurrentThread(): Promise<BbDesktopPopoutThreadChangedPayload>;
  toggle(): void;
  setThread(thread: BbDesktopPopoutThreadRef): void;
  stateChanged(thread: BbDesktopPopoutThreadChangedPayload): void;
  openInMain(thread: BbDesktopPopoutThreadRef): void;
  setMouseEventsIgnored(
    request: BbDesktopPopoutMouseEventsIgnoredRequest,
  ): void;
  onThreadChanged(
    listener: BbDesktopPopoutThreadChangedHandler,
  ): BbDesktopPopoutUnsubscribe;
}

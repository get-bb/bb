import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { z } from "zod";

export const BB_DESKTOP_POPOUT_ID_MAX_LENGTH = 200;
export const POPOUT_ROUTE_PATH = "/popout";
export const POPOUT_WINDOW_WIDTH = 480;
export const POPOUT_WINDOW_HEIGHT = 620;
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

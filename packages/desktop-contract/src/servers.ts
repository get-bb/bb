import { z } from "zod";

export const bbDesktopServerSourceSchema = z.enum([
  "builtin",
  "manual",
  "connect",
]);
export type BbDesktopServerSource = z.infer<typeof bbDesktopServerSourceSchema>;

export const bbDesktopServerStatusSchema = z.enum([
  "connected",
  "offline",
  "incompatible",
  "unknown",
]);
export type BbDesktopServerStatus = z.infer<typeof bbDesktopServerStatusSchema>;

export const bbDesktopServerListEntrySchema = z
  .object({
    active: z.boolean(),
    /** Favicon palette id, or null for the default (token) tile color. */
    color: z.string().nullable(),
    /** Hugeicons registry name, or null for the letter glyph. */
    icon: z.string().nullable(),
    id: z.string().min(1),
    name: z.string().min(1),
    source: bbDesktopServerSourceSchema,
    status: bbDesktopServerStatusSchema,
    url: z.string().min(1),
  })
  .strict();
export type BbDesktopServerListEntry = z.infer<
  typeof bbDesktopServerListEntrySchema
>;

export const bbDesktopServerAddRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    url: z.string().min(1).max(4096),
  })
  .strict();
export type BbDesktopServerAddRequest = z.infer<
  typeof bbDesktopServerAddRequestSchema
>;

export const bbDesktopServerAddFailureReasonSchema = z.enum([
  "duplicate",
  "incompatible",
  "unreachable",
]);
export type BbDesktopServerAddFailureReason = z.infer<
  typeof bbDesktopServerAddFailureReasonSchema
>;

export const bbDesktopServerAddResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      server: bbDesktopServerListEntrySchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: bbDesktopServerAddFailureReasonSchema,
    })
    .strict(),
]);
export type BbDesktopServerAddResult = z.infer<
  typeof bbDesktopServerAddResultSchema
>;

export const bbDesktopServerIdRequestSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();
export type BbDesktopServerIdRequest = z.infer<
  typeof bbDesktopServerIdRequestSchema
>;

export const bbDesktopServerRenameRequestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(200),
  })
  .strict();
export type BbDesktopServerRenameRequest = z.infer<
  typeof bbDesktopServerRenameRequestSchema
>;

/**
 * Shell stores icon/color as opaque trimmed strings (max 100). The renderer
 * validates against ICON_NAMES / FAVICON_COLORS and falls back on unknown
 * values so version skew either direction stays safe.
 */
const bbDesktopServerTileStyleFieldSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}, z.union([z.string().min(1).max(100), z.null()]));

export const bbDesktopServerSetTileStyleRequestSchema = z
  .object({
    id: z.string().min(1),
    icon: bbDesktopServerTileStyleFieldSchema,
    color: bbDesktopServerTileStyleFieldSchema,
  })
  .strict();
export type BbDesktopServerSetTileStyleRequest = z.infer<
  typeof bbDesktopServerSetTileStyleRequestSchema
>;

export const bbDesktopServerSetAutoConnectRequestSchema = z
  .object({
    autoConnectToLocalServer: z.boolean(),
  })
  .strict();
export type BbDesktopServerSetAutoConnectRequest = z.infer<
  typeof bbDesktopServerSetAutoConnectRequestSchema
>;

export const bbDesktopServerSetShowConnectServersRequestSchema = z
  .object({
    showConnectServers: z.boolean(),
  })
  .strict();
export type BbDesktopServerSetShowConnectServersRequest = z.infer<
  typeof bbDesktopServerSetShowConnectServersRequestSchema
>;

export type BbDesktopServersChangeHandler = (
  servers: BbDesktopServerListEntry[],
) => void;
export type BbDesktopServersUnsubscribe = () => void;

/**
 * Multi-server registry and per-window switching. The Electron main process
 * owns persistence, probing, and navigation; the renderer only drives these
 * typed commands over the preload bridge.
 *
 * Version-skew warning: older desktop shells may omit `window.bbDesktop.servers`
 * entirely. Callers must feature-detect before use.
 */
export interface BbDesktopServersApi {
  list(): Promise<BbDesktopServerListEntry[]>;
  add(request: BbDesktopServerAddRequest): Promise<BbDesktopServerAddResult>;
  remove(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  setActive(id: string): Promise<void>;
  setTileStyle(request: BbDesktopServerSetTileStyleRequest): Promise<void>;
  getAutoConnect(): Promise<boolean>;
  setAutoConnect(autoConnectToLocalServer: boolean): Promise<void>;
  getShowConnectServers(): Promise<boolean>;
  setShowConnectServers(showConnectServers: boolean): Promise<void>;
  onChange(listener: BbDesktopServersChangeHandler): BbDesktopServersUnsubscribe;
}

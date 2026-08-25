import { z } from "zod";

/**
 * The provider extension-state kind this plugin declares and renders: the
 * current snapshot of what Pi's extensions put beside the composer through
 * `ctx.ui` (statuses, widgets, notifications, the title, editor text). The
 * bridge builds it from pi's `extension_ui_request` events in RPC mode; the
 * app bundle renders it. Shared here so the declaration's schema and the
 * renderer's parser are one.
 */
export const PI_EXTENSION_UI_STATE_NAME = "extension-ui";

export const PI_EXTENSION_STATUS_MAX = 16;
export const PI_EXTENSION_WIDGET_MAX = 16;
export const PI_EXTENSION_NOTIFICATION_MAX = 8;
export const PI_EXTENSION_WIDGET_LINE_MAX = 32;

const statusSchema = z
  .object({
    key: z.string().max(128),
    text: z.string().max(512),
  })
  .strict();

const widgetSchema = z
  .object({
    key: z.string().max(128),
    lines: z.array(z.string().max(1_024)).max(PI_EXTENSION_WIDGET_LINE_MAX),
    placement: z.enum(["aboveEditor", "belowEditor"]),
  })
  .strict();

const notificationSchema = z
  .object({
    id: z.number().int().positive(),
    message: z.string().max(1_024),
    level: z.enum(["info", "warning", "error"]),
  })
  .strict();

export const piExtensionUIStateSchema = z
  .object({
    statuses: z.array(statusSchema).max(PI_EXTENSION_STATUS_MAX),
    widgets: z.array(widgetSchema).max(PI_EXTENSION_WIDGET_MAX),
    notifications: z.array(notificationSchema).max(PI_EXTENSION_NOTIFICATION_MAX),
    title: z.string().max(1_024).nullable(),
    editor: z
      .object({
        revision: z.number().int().positive(),
        text: z.string().max(16_384),
      })
      .strict()
      .nullable(),
  })
  .strict();

/** A null snapshot clears the state (the owning session ended). */
export const piExtensionUIStateUpdateSchema = piExtensionUIStateSchema.nullable();
export type PiExtensionUIState = z.infer<typeof piExtensionUIStateSchema>;

import { z } from "zod";

export const BB_DESKTOP_SERVER_URL_DIALOG_SUBMIT_CHANNEL =
  "bb-desktop:server-url-dialog:submit";
export const BB_DESKTOP_SERVER_URL_DIALOG_CANCEL_CHANNEL =
  "bb-desktop:server-url-dialog:cancel";

export const serverUrlDialogSubmitRequestSchema = z
  .object({
    url: z.string().max(4096),
  })
  .strict();

export const serverUrlDialogSubmitResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), message: z.string() }).strict(),
]);
export type ServerUrlDialogSubmitResponse = z.infer<
  typeof serverUrlDialogSubmitResponseSchema
>;

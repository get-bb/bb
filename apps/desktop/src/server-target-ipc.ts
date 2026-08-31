import { z } from "zod";

export const addCustomServerRequestSchema = z
  .object({
    name: z.string().max(200),
    url: z.string().max(4096),
  })
  .strict();
export type AddCustomServerRequest = z.infer<
  typeof addCustomServerRequestSchema
>;

export const BB_DESKTOP_GET_SERVER_TARGET_CHANNEL =
  "bb-desktop:get-server-target";
export const BB_DESKTOP_SET_SERVER_TARGET_CHANNEL =
  "bb-desktop:set-server-target";
export const BB_DESKTOP_ADD_CUSTOM_SERVER_CHANNEL =
  "bb-desktop:add-custom-server";
export const BB_DESKTOP_REMOVE_CUSTOM_SERVER_CHANNEL =
  "bb-desktop:remove-custom-server";
export const BB_DESKTOP_SET_CONNECT_TRUSTED_CHANNEL =
  "bb-desktop:set-connect-trusted";
export const BB_DESKTOP_SERVER_TARGET_CHANGED_CHANNEL =
  "bb-desktop:server-target-changed";

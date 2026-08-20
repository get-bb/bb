// The secret-request payload/response contract lives in
// @bb/plugin-interaction-contracts so clients that cannot run this plugin's
// React DOM bundle (the native app) can render the same secure form.
// Re-exported here so the plugin's own modules keep one import path.
export {
  SECRET_REQUEST_RENDERER_ID,
  secretNameSchema,
  secretRequestPayloadSchema,
  secretRequestResponseSchema,
  type SecretRequestPayload,
  type SecretRequestResponse,
} from "@bb/plugin-interaction-contracts";

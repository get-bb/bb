// @bb/plugin-interaction-contracts: the payload/response zod schemas of the
// bundled plugins' pending interactions (`ask-user-question`,
// `secret-request`). A real cross-package contract: the plugins produce and
// consume these on the server, and clients that cannot run the plugins' React
// DOM bundles (the native app) render the same forms natively from them.
export {
  ASK_USER_QUESTION_RENDERER_ID,
  MAX_OPTION_PREVIEW_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  interactionPayloadSchema,
  interactionResponseSchema,
  type InteractionAnswer,
  type InteractionOption,
  type InteractionPayload,
  type InteractionQuestion,
  type InteractionResponse,
} from "./ask-user-question.js";
export {
  SECRET_REQUEST_RENDERER_ID,
  secretNameSchema,
  secretRequestPayloadSchema,
  secretRequestResponseSchema,
  type SecretRequestPayload,
  type SecretRequestResponse,
} from "./secret-request.js";

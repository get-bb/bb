import type { DeltaPresentation } from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";

export const RAPP_PLUGIN_ID = "provider-rapp";
export const RAPP_PROVIDER_ID = "rapp";
export const RAPP_SPEC = "rapp/1";
export const RAPP_MODEL_ID = "brainstem";
export const RAPP_BUSINESS_MODEL_ID = "business-grail";
export const RAPP_SESSION_STATE_KIND = `${RAPP_PLUGIN_ID}/session` as const;

export const RAPP_BRAINSTEM_URL_ENV = "RAPP_BRAINSTEM_URL";
export const RAPP_BRAINSTEM_SECRET_ENV = "RAPP_BRAINSTEM_SECRET";
export const RAPP_BUSINESS_URL_ENV = "RAPP_BUSINESS_URL";
export const RAPP_FUNCTION_KEY_ENV = "RAPP_FUNCTION_KEY";
export const RAPP_USER_GUID_ENV = "RAPP_USER_GUID";

export const rappGrailSchema = z.enum(["consumer", "business"]);
export type RappGrail = z.infer<typeof rappGrailSchema>;

export const RAPP_ENDPOINT_URL_REQUIREMENTS =
  "Use an HTTP(S) RAPP endpoint without URL credentials, query parameters, or fragments; put credentials in the documented host environment variables and routing in the documented endpoint path";

export const rappEndpointSettingSchema = z.string().refine((value) => {
  const trimmed = value.trim();
  if (trimmed === "") {
    return true;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    if (url.username !== "" || url.password !== "") {
      return false;
    }
    return url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}, RAPP_ENDPOINT_URL_REQUIREMENTS);

export const rappPluginSettingsSchema = z.object({
  grail: rappGrailSchema,
  endpoint: rappEndpointSettingSchema,
});
export type RappPluginSettings = z.infer<typeof rappPluginSettingsSchema>;

export const rappCatalogOptionsSchema = rappPluginSettingsSchema;
export type RappCatalogOptions = z.infer<typeof rappCatalogOptionsSchema>;

export const rappProviderOptionsSchema = z
  .object({
    grail: rappGrailSchema,
    endpoint: rappEndpointSettingSchema,
    model: z.string().min(1),
  })
  .superRefine((options, context) => {
    if (
      options.grail === "business" &&
      options.model !== RAPP_BUSINESS_MODEL_ID
    ) {
      context.addIssue({
        code: "custom",
        path: ["model"],
        message: `Business Grail requires model ${RAPP_BUSINESS_MODEL_ID}`,
      });
    }
    if (
      options.grail === "consumer" &&
      options.model === RAPP_BUSINESS_MODEL_ID
    ) {
      context.addIssue({
        code: "custom",
        path: ["model"],
        message: `${RAPP_BUSINESS_MODEL_ID} is only available through the Business Grail`,
      });
    }
  });
export type RappProviderOptions = z.infer<typeof rappProviderOptionsSchema>;

export const RAPP_BRAINSTEM_MODEL = {
  id: RAPP_MODEL_ID,
  displayName: "GitHub Copilot (Brainstem default)",
  description:
    "Use the GitHub Copilot model currently selected by RAPP Brainstem.",
  supportedReasoningEfforts: [
    {
      reasoningEffort: "none",
      description:
        "RAPP Brainstem owns GitHub Copilot reasoning and execution.",
    },
  ],
  defaultReasoningEffort: "none",
  isDefault: true,
} as const;

export const RAPP_BUSINESS_MODEL = {
  id: RAPP_BUSINESS_MODEL_ID,
  displayName: "Business Grail",
  description:
    "Use the fixed managed model owned by the configured Business RAPP deployment.",
  supportedReasoningEfforts: [
    {
      reasoningEffort: "none",
      description:
        "RAPP Brainstem owns GitHub Copilot reasoning and execution.",
    },
  ],
  defaultReasoningEffort: "none",
  isDefault: true,
} as const;

export const rappSessionStateSchema = z.object({
  spec: z.literal(RAPP_SPEC),
  grail: rappGrailSchema,
  rappid: z.string().min(1),
  sessionId: z.string().min(1).nullable(),
  turnCount: z.number().int().nonnegative(),
  eggAddress: z.string().regex(/^[0-9a-f]{64}$/u),
  endpoint: z.string().url(),
  selectedModel: z.string().min(1),
  requestedModel: z.string().min(1).nullable(),
  actualModel: z.string().min(1).nullable(),
});

export const rappExtensionKinds = {
  session: { state: rappSessionStateSchema },
} as const;

export const RAPP_AGENT_ACTIVITY_PRESENTATION: DeltaPresentation = {
  label: {
    pending: "Running RAPP agents",
    completed: "Ran RAPP agents",
  },
  icon: { glyph: "Bot" },
  suppress: true,
};

export const RAPP_MESSAGE_PRESENTATION: DeltaPresentation = {
  label: {
    pending: "Thinking through RAPP",
    completed: "Answered through RAPP",
  },
  icon: { glyph: "Brain" },
};

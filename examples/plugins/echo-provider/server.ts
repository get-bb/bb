/**
 * Echo provider — the third-party canary for bb's provider plugin API.
 *
 * A marketplace plugin must be able to do everything the first-party
 * providers do, using ONLY the public SDK (`@get-bb/plugin-sdk` and its
 * subpaths) plus zod. This plugin exercises every registration capability
 * and, in its bridge, every grammar v3 timeline capability, so the public
 * surface is proven by code that has no first-party privilege. The test
 * `public-sdk-only.test.ts` fails the moment a `@bb/*` import appears here.
 *
 * Surfaces demonstrated in this file:
 * - bb.settings.define — a plugin-owned toggle (`shout`) that reaches the
 *   bridge through `deriveProviderOptions` → `providerOptions`.
 * - bb.agents.registerTool — a bb tool with `presentation`; the
 *   bridge calls it over `item/tool/call` and stamps the definition's
 *   presentation on the call's row beside `server: "bb"`.
 * - bb.providers.register — the full declaration: strings (with icon tint),
 *   labelled reasoning levels and service tiers, capabilities, composer
 *   actions, cold-cache fallback models, env passthrough, one native skill
 *   root, provider options, and two extension kinds (an item kind and a
 *   state kind) with zod schemas the server enforces at ingest.
 * - bb.host (package.json) — the one host artifact carrying the bridge
 *   (`experimental_providerBridge`) and a host RPC entry (see host.ts).
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  ECHO_GREETING_ENV,
  ECHO_MODEL,
  ECHO_PROJECT_SKILL_ROOT,
  ECHO_PROVIDER_ID,
  ECHO_STAMP_TOOL_NAME,
  ECHO_STAMP_TOOL_PRESENTATION,
  echoExtensionKinds,
  echoStampToolParametersSchema,
  type EchoProviderOptions,
} from "./src/vocabulary.js";

export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
    shout: {
      type: "boolean",
      label: "Shout",
      description: "Echo every prompt in upper case.",
      default: false,
    },
  });

  // A bb tool the echo bridge calls during every turn. The row it produces
  // reads the way this presentation says — resolved by the server into the
  // tool definition, stamped by the bridge, persisted with the item.
  bb.agents.registerTool({
    name: ECHO_STAMP_TOOL_NAME,
    description: "Stamp a piece of text with the echo provider's seal.",
    parameters: echoStampToolParametersSchema,
    presentation: ECHO_STAMP_TOOL_PRESENTATION,
    execute: ({ text }) => `stamped: ${text}`,
  });

  bb.providers.register({
    id: ECHO_PROVIDER_ID,
    displayName: "Echo",
    icon: "Zap",
    strings: {
      signInHint: "Nothing to sign in to: the echo agent runs offline.",
      expiredHint: "Echo sessions never expire.",
      installUrl:
        "https://github.com/get-bb/bb/tree/main/examples/plugins/echo-provider",
      brandPrefix: "Echo ",
      planModeCopy: "Echo will repeat your plan without running anything.",
      iconTint: { light: "#b45309", dark: "#fcd34d" },
    },
    // `health: true` is the cheapest maintenance surface: the server polls
    // `provider/health` through the bridge (src/provider-bridge.ts answers a
    // fixed "ready"), which proves the maintenance wire end to end. Usage and
    // installation stay off — an echo has no subscription and nothing to
    // install — so the runtime never sends those requests to this bridge.
    maintenance: { health: true, usage: false, installation: false },
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: "none",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: ["low", "medium", "high"],
    },
    reasoningLevels: [
      { id: "low", label: "Whisper" },
      { id: "medium", label: "Speak" },
      { id: "high", label: "Shout", description: "Echo with conviction." },
    ],
    serviceTiers: [
      { id: "default", label: "Default" },
      { id: "fast", label: "Fast" },
    ],
    composerActions: ["plan"],
    models: { fallback: [ECHO_MODEL] },
    env: { passthrough: [ECHO_GREETING_ENV] },
    // One directory the echo agent reads its own skills from, relative to
    // the workspace. bb scans it beside its own skill roots when it lists a
    // project's skills; core never guesses a provider's skill layout.
    experimental_nativeSkillRoots: { project: [ECHO_PROJECT_SKILL_ROOT] },
    // Called on EVERY session and turn command. The bridge reads this back
    // from `options.providerOptions` and echoes it, proving the round trip
    // plugin setting → server → daemon → bridge → timeline.
    deriveProviderOptions(context): EchoProviderOptions {
      return {
        shout: context.settings.shout === true,
        model: context.model,
        promptMode: context.promptMode ?? null,
      };
    },
    extensionKinds: echoExtensionKinds,
  });
}

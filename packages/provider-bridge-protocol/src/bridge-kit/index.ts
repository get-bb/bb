/**
 * The provider bridge kit: the runtime-agnostic building blocks a bridge
 * process uses to speak the canonical protocol — JSON-RPC plumbing, the stdio
 * harness, tool-call and interaction codecs, provider-dialect parsing
 * helpers, and the visibility classification every bb-authored bridge shares.
 * Timeline assembly (turn/item id minting, accepted-input correlation, item
 * settlement) is not here: bridges emit `thread/delta` and the runtime's
 * delta assembler owns all of it.
 *
 * A bridge ships from its plugin as a self-contained bundle, so everything
 * here must stay free of `@bb/agent-runtime` (the runtime imports the kit, not
 * the other way round).
 */
export * from "./adapter-utils.js";
export * from "./bounded-line-reader.js";
export * from "./bridge-harness.js";
export * from "./bridge-recorder.js";
export * from "./bridge-runtime-env.js";
export * from "./bridge-tool-calls.js";
export * from "./contracts.js";
export * from "./json-rpc-envelope.js";
export * from "./mime-types.js";
export * from "./pending-tool-call-tracker.js";
export * from "./permission-policy.js";
export * from "./provider-bridge-entry.js";
export * from "./provider-tool-call-contract.js";
export * from "./provider-visibility.js";
export * from "./provider-visibility-helpers.js";
export * from "./runtime-json-rpc.js";
export * from "./tool-arg-schemas.js";

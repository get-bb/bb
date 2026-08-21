/**
 * Test infrastructure for bridge authors: an in-process JSON-RPC driver for a
 * bridge's line handler, the delta→event collector that runs captured
 * `thread/delta` notifications through the real assembler, and the
 * calibration normalizer that makes scripted whole-session ThreadEvent
 * goldens comparable across runs. Published to plugins as
 * `@get-bb/plugin-sdk/provider-bridge/testing` beside the conformance kit.
 */
export * from "./bridge-json-rpc-test-helpers.js";
export * from "./bridge-delta-assembly.js";
export * from "./calibration-diff.js";
export * from "./parity.js";
export * from "./recording.js";

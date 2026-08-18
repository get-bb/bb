/**
 * Test infrastructure for bridge authors: an in-process JSON-RPC driver for a
 * bridge's line handler, and the calibration normalizer that makes scripted
 * whole-session ThreadEvent goldens comparable across runs.
 */
export * from "./bridge-json-rpc-test-helpers.js";
export * from "./calibration-diff.js";

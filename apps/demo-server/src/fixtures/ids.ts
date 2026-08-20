// Stable identifiers for the demo data. Fixed values, never generated, so the
// same thread ids work in a deep link and in the review notes.

export const DEMO_PROJECT_ID = "proj_demo00000001";
export const DEMO_HOST_ID = "host_demo0000001";

/**
 * Fixed clock for the seeded data. Workers have no meaningful startup time and
 * a moving "now" would make every response differ, so timestamps are frozen
 * and the app renders stable relative times.
 */
export const DEMO_NOW = 1787270000000;

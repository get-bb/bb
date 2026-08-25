/**
 * Size and count limits used by the RPC schemas.
 *
 * Kept free of imports on purpose: when the frontend needs one of these
 * numbers it must import it from here, because importing it from
 * `rpc-types.ts` would drag zod and every schema
 * into `dist/app.js`, which the app dynamic-imports and evaluates on every
 * boot (the bundle URL is content-hashed and served immutable, so the
 * recurring cost is parse/evaluate, not download). `frontend-imports.test.ts`
 * guards the split.
 */
export const AUTOMATION_NAME_MAX_LENGTH = 200;
export const AUTOMATION_SCRIPT_MAX_LENGTH = 262_144;
export const AUTOMATION_SCRIPT_FILE_MAX_LENGTH = 200;
export const SCHEDULE_CRON_MAX_LENGTH = 100;
export const SCHEDULE_TIMEZONE_MAX_LENGTH = 100;
export const AUTOMATION_IDEMPOTENCY_KEY_MAX_LENGTH = 200;
export const AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS = 120_000;
export const AUTOMATION_SCRIPT_TIMEOUT_MAX_MS = 900_000;
export const AUTOMATION_RUNS_LIMIT_DEFAULT = 50;
export const AUTOMATION_RUNS_LIMIT_MAX = 200;

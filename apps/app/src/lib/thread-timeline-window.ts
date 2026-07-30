/**
 * User-message-anchored conversation segments mounted per timeline page.
 *
 * Rich message rows are expensive browser work. Keep the app window bounded;
 * the full outline remains available and older pages load through the cursor.
 */
export const APP_THREAD_TIMELINE_SEGMENT_LIMIT = "8";

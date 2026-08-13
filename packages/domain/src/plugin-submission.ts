/**
 * BB's plugin marketplace intake form (GitHub URL, name, description, why it's
 * useful, email). The form is the entire submission UI for now — the app's
 * detail-page action and `bb plugin submit` both link out to it, so there is
 * no schema, route, or field validation on the bb side to keep in sync with
 * its questions.
 *
 * Lives in @bb/domain because the app and the CLI both need it and it is a
 * product fact, not a wire contract. A module constant rather than a setting:
 * this is BB's own form, not anything a user configures.
 */
export const PLUGIN_SUBMISSION_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLScRTABhHwCjuZWYn0lJJd0aZT2cYvGk2KaZ2GF-1GsXoLMLSQ/viewform";

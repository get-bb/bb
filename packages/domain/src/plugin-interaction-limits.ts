/** Maximum title length accepted by plugin UI interaction requests. */
export const PLUGIN_INTERACTION_MAX_TITLE_LENGTH = 160;

/**
 * Maximum size, in UTF-8 bytes of its JSON form, of a plugin form's data
 * (the request a plugin or a provider raises) and of the form's answer.
 * Enforced at every ingest: the plugin API, the bridge wire, and the
 * answer routes.
 */
export const PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES = 64 * 1024;

/** The UTF-8 byte length of a value's JSON form. */
export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

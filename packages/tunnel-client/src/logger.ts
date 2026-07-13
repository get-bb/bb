/**
 * Minimal logger surface used by the tunnel client.
 *
 * Declares the same method names as PluginLogger so existing plugin call
 * sites and tests can pass their logger through without adapting. Only
 * `warn` is required; the session currently uses that alone. Callers
 * adapt their own logger rather than depending on plugin-sdk from this
 * package.
 */
export interface TunnelClientLogger {
  debug?(message: string): void;
  info?(message: string): void;
  warn(message: string): void;
  error?(message: string): void;
}

export interface TunnelClientLogger {
  info?(message: string): void;
  warn(message: string): void;
}

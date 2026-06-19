// Parcel's FSEvents backend reports recoverable dropped-events with this phrase:
// the OS kept the stream alive but asked us to re-scan to catch up. The
// subprocess proxy also reuses it to ask RootSubscription to re-establish a
// watch through its existence-gated, backed-off retry path (rather than treating
// a transient establish failure as a permanent watch death). Kept in a
// dependency-free leaf module so both root-subscription and the proxy can share
// it without an import cycle.
export const RESCAN_REQUIRED_MESSAGE = "File system must be re-scanned";

export function isRescanRequiredMessage(message: string): boolean {
  return message.includes(RESCAN_REQUIRED_MESSAGE);
}

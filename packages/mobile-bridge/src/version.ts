/**
 * The shell renders whatever page the server serves, so the two sides ship on
 * their own schedules. One integer covers both directions.
 */

/**
 * The contract version this build of the shell and the page implements.
 *
 * 2 — adds `open-native`, so the page can send the user to a native screen.
 * 1 — haptics, badge, share, external links, safe area, ready/title.
 *
 * A version bump is not how the page decides what it may call: capabilities
 * are declared in the handshake, so an older shell simply does not list the
 * new one. The number exists for support reports and for a floor.
 */
export const MOBILE_BRIDGE_VERSION = 2;

/**
 * The oldest contract a shell still understands. Raise it only when a
 * released shell can no longer serve an older page at all, because raising it
 * makes every server below that version unusable from the app.
 */
export const MINIMUM_MOBILE_BRIDGE_VERSION = 1;

/** The global the shell installs on the page, and the page reads once at boot. */
export const NATIVE_BRIDGE_GLOBAL = "bb";

interface VersionPair {
  /** The contract the other side speaks. */
  remoteVersion: number;
  /** The contract this build speaks. */
  localVersion: number;
}

export type BridgeCompatibility =
  /** Same contract; every feature of this build is available. */
  | { kind: "supported" }
  /**
   * The other side is older. This build keeps working and simply uses fewer
   * message kinds. The shell meets this when a server serves an older page.
   */
  | ({ kind: "older-peer" } & VersionPair)
  /**
   * The other side is newer. This build must ignore what it does not know,
   * and the page must fall back to web behaviour for anything the shell
   * cannot answer. The page meets this when a phone lags behind the server.
   */
  | ({ kind: "newer-peer" } & VersionPair)
  /** Below this build's floor. Treat the bridge as absent. */
  | ({ kind: "unsupported" } & VersionPair);

/**
 * Compare the contract the other side speaks with this build's. Symmetric:
 * both the shell and the page call it with the version they were handed.
 * Neither side may throw on a mismatch, because an old server serves an old
 * page and a phone updates on its own schedule.
 */
export function compareBridgeVersions(
  remoteVersion: number,
  localVersion: number = MOBILE_BRIDGE_VERSION,
): BridgeCompatibility {
  if (!Number.isInteger(remoteVersion) || remoteVersion < 1) {
    return { kind: "unsupported", remoteVersion, localVersion };
  }
  if (remoteVersion < MINIMUM_MOBILE_BRIDGE_VERSION) {
    return { kind: "unsupported", remoteVersion, localVersion };
  }
  if (remoteVersion === localVersion) return { kind: "supported" };
  return remoteVersion < localVersion
    ? { kind: "older-peer", remoteVersion, localVersion }
    : { kind: "newer-peer", remoteVersion, localVersion };
}

/** Whether this build may use the bridge at all. */
export function isBridgeUsable(compatibility: BridgeCompatibility): boolean {
  return compatibility.kind !== "unsupported";
}

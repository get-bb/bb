import {
  SealedChannelClient,
  SealedDeviceCodeError,
  SealedServerKeyMismatchError,
  base64UrlDecode,
  base64UrlEncode,
  bytesEqual,
  createWebSocketSealedSocket,
  keyFingerprint,
  sealedEndpointUrl,
  sealedFetch,
  type RejectReason,
  type SealedWebSocketStream,
} from "@bb/sealed-channel";
import { withLocalStorage } from "@/lib/browser-storage";
import {
  clearLocalDeviceKey,
  type SealedDeviceProfile,
} from "./device-identity";
import type { SealedTrustRecord, SealedTrustStore } from "./trust-store";

export const SEALED_ENDPOINT_PATH = "/api/v1/plugins/connect/http/sealed";
export const SEALED_INFO_PATH = `${SEALED_ENDPOINT_PATH}/info`;

export type SealedState =
  | { kind: "idle" }
  | { kind: "connecting"; attempt: number }
  | {
      kind: "ready";
      deviceId: string;
      fingerprint: string;
      verified: boolean;
      acknowledged: boolean;
    }
  | {
      kind: "pending";
      deviceId: string;
      fingerprint: string;
      verified: boolean;
    }
  | { kind: "rejected"; reason: RejectReason; fingerprint: string | null }
  | {
      kind: "key-mismatch";
      expected: string;
      actual: string;
      presentedKey: string;
    }
  | {
      kind: "offline";
      retryAt: number;
      error: string;
      fingerprint: string | null;
    };

export interface SealedConnectionOptions {
  origin: string;
  profile: SealedDeviceProfile;
  trust: SealedTrustStore;
  expectedServerKey?: string | null;
  hostVerified?: boolean;
  WebSocketImpl?: typeof WebSocket;
  now?: () => number;
}

const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const PENDING_POLL_MS = 5_000;

export class SealedConnection {
  private client: SealedChannelClient | null = null;
  private connecting: Promise<SealedChannelClient> | null = null;
  private state: SealedState = { kind: "idle" };
  private readonly listeners = new Set<() => void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private pendingDeviceCode: string | null = null;
  private expectedServerKeyOverride: string | null | undefined;
  private stopped = false;
  private readonly now: () => number;

  constructor(private readonly options: SealedConnectionOptions) {
    this.now = options.now ?? Date.now;
  }

  get origin(): string {
    return this.options.origin;
  }

  getState(): SealedState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async trustRecord(): Promise<SealedTrustRecord | null> {
    return this.options.trust.get(this.options.origin);
  }

  async markVerified(): Promise<void> {
    const record = await this.trustRecord();
    if (record === null) return;
    await this.options.trust.set(this.options.origin, {
      ...record,
      verified: true,
    });
    if (this.state.kind === "ready") {
      this.setState({ ...this.state, verified: true, acknowledged: true });
    } else if (this.state.kind === "pending") {
      this.setState({ ...this.state, verified: true });
    }
  }

  async acknowledgeUnverified(): Promise<void> {
    const record = await this.trustRecord();
    if (record === null) return;
    await this.options.trust.set(this.options.origin, {
      ...record,
      acknowledged: true,
    });
    if (this.state.kind === "ready") {
      this.setState({ ...this.state, acknowledged: true });
    }
  }

  async forgetTrust(): Promise<void> {
    await this.options.trust.clear(this.options.origin);
    withLocalStorage((storage) => {
      storage.removeItem(`bb.sealed.readable:${this.options.origin}`);
    }, undefined);
    if (
      this.options.profile.surface === "browser" ||
      this.options.profile.surface === "mobile-webview"
    ) {
      clearLocalDeviceKey();
    }
    this.client?.close(1000, "trust reset");
  }

  async trustPresentedKey(): Promise<void> {
    const state = this.state;
    if (state.kind !== "key-mismatch") return;
    const record = await this.trustRecord();
    await this.options.trust.set(this.options.origin, {
      serverKey: state.presentedKey,
      fingerprint: state.actual,
      verified: true,
      deviceId: record?.deviceId ?? null,
      pinnedAt: this.now(),
    });
    this.expectedServerKeyOverride = state.presentedKey;
    this.clearRetry();
    void this.ensure().catch(() => {});
  }

  useDeviceCode(code: string): void {
    this.pendingDeviceCode = code;
    this.client?.close(1000, "re-enrolling with a device code");
    this.clearRetry();
    void this.ensure().catch(() => {});
  }

  stop(): void {
    this.stopped = true;
    this.clearRetry();
    this.client?.close(1000, "stopped");
  }

  ensure(): Promise<SealedChannelClient> {
    if (this.client !== null && this.client.isOpen)
      return Promise.resolve(this.client);
    if (this.connecting !== null) return this.connecting;
    this.connecting = this.connectOnce().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const client = await this.ensure();
    return sealedFetch(client, input, init, { origin: this.options.origin });
  }

  async openWebSocket(
    path: string,
    protocols: string[],
  ): Promise<SealedWebSocketStream> {
    const client = await this.ensure();
    return client.openWebSocket({ path, protocols });
  }

  private setState(state: SealedState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry(delayMs: number): void {
    this.clearRetry();
    if (this.stopped) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.ensure().catch(() => {});
    }, delayMs);
  }

  private async connectOnce(): Promise<SealedChannelClient> {
    this.attempt += 1;
    this.setState({ kind: "connecting", attempt: this.attempt });
    const record = await this.trustRecord();
    const expectedSource =
      this.expectedServerKeyOverride !== undefined
        ? this.expectedServerKeyOverride
        : this.options.expectedServerKey;
    const expectedFromHost =
      expectedSource === undefined || expectedSource === null
        ? null
        : base64UrlDecode(expectedSource);
    const pinned = record === null ? null : base64UrlDecode(record.serverKey);
    const deviceCode = this.pendingDeviceCode;
    const delegation = this.options.profile.delegation;
    const WebSocketImpl = this.options.WebSocketImpl ?? WebSocket;
    const socket = createWebSocketSealedSocket(
      sealedEndpointUrl(this.options.origin, SEALED_ENDPOINT_PATH),
      WebSocketImpl as never,
    );
    const seen: {
      mismatch: {
        expected: string;
        actual: string;
        presentedKey: string;
      } | null;
      key: Uint8Array | null;
    } = { mismatch: null, key: null };
    try {
      const connection = await SealedChannelClient.connect({
        socket,
        device: this.options.profile.identity,
        deviceName: this.options.profile.name,
        surface: this.options.profile.surface,
        ...(deviceCode !== null ? { deviceCode } : {}),
        ...(delegation !== null ? { delegation } : {}),
        verifyServerKey: (serverKey) => {
          seen.key = serverKey;
          const expected = expectedFromHost ?? pinned;
          if (expected !== null && !bytesEqual(expected, serverKey)) {
            seen.mismatch = {
              expected: keyFingerprint(expected),
              actual: keyFingerprint(serverKey),
              presentedKey: base64UrlEncode(serverKey),
            };
            return "reject";
          }
          return "accept";
        },
      });
      const fingerprint = keyFingerprint(connection.serverPublicKey);
      const acceptedKey = base64UrlEncode(connection.serverPublicKey);
      const sameKeyRecord =
        record !== null && record.serverKey === acceptedKey ? record : null;
      const verified =
        deviceCode !== null ||
        sameKeyRecord?.verified === true ||
        (expectedFromHost !== null &&
          this.expectedServerKeyOverride === undefined &&
          this.options.hostVerified === true) ||
        (this.expectedServerKeyOverride !== undefined &&
          this.expectedServerKeyOverride !== null);
      const acknowledged = verified || sameKeyRecord?.acknowledged === true;
      if (connection.outcome.status === "ok") {
        this.pendingDeviceCode = null;
        await this.options.trust.set(this.options.origin, {
          serverKey: base64UrlEncode(connection.serverPublicKey),
          fingerprint,
          verified,
          acknowledged,
          deviceId: connection.outcome.deviceId,
          pinnedAt: record?.pinnedAt ?? this.now(),
        });
      }
      if (connection.client === null || connection.outcome.status !== "ok") {
        const outcome = connection.outcome;
        if (outcome.status === "pending") {
          await this.options.trust.set(this.options.origin, {
            serverKey: base64UrlEncode(connection.serverPublicKey),
            fingerprint,
            verified,
            deviceId: outcome.deviceId,
            pinnedAt: record?.pinnedAt ?? this.now(),
          });
          this.setState({
            kind: "pending",
            deviceId: outcome.deviceId,
            fingerprint,
            verified,
          });
          this.scheduleRetry(PENDING_POLL_MS);
          throw new SealedHandshakeError("pending");
        }
        this.pendingDeviceCode = null;
        this.setState({
          kind: "rejected",
          reason: outcome.status === "rejected" ? outcome.reason : "protocol",
          fingerprint,
        });
        throw new SealedHandshakeError("rejected");
      }
      const client = connection.client;
      this.client = client;
      this.attempt = 0;
      client.onClose((code, reason) => {
        if (this.client !== client) return;
        this.client = null;
        if (this.stopped) {
          this.setState({ kind: "idle" });
          return;
        }
        const delay = Math.min(
          MAX_RETRY_MS,
          MIN_RETRY_MS * 2 ** Math.min(this.attempt, 5),
        );
        this.setState({
          kind: "offline",
          retryAt: this.now() + delay,
          error: reason || `closed (${code})`,
          fingerprint,
        });
        this.scheduleRetry(delay);
      });
      this.setState({
        kind: "ready",
        deviceId: connection.outcome.deviceId,
        fingerprint,
        verified,
        acknowledged,
      });
      return client;
    } catch (error) {
      if (error instanceof SealedHandshakeError) throw error;
      if (error instanceof SealedDeviceCodeError) {
        this.pendingDeviceCode = null;
        if (record !== null && !record.verified) {
          await this.options.trust.clear(this.options.origin);
        }
        this.setState({
          kind: "rejected",
          reason: "invalid-code",
          fingerprint: seen.key === null ? null : keyFingerprint(seen.key),
        });
        throw error;
      }
      if (
        error instanceof SealedServerKeyMismatchError &&
        seen.mismatch !== null
      ) {
        this.setState({ kind: "key-mismatch", ...seen.mismatch });
        throw error;
      }
      const delay = Math.min(
        MAX_RETRY_MS,
        MIN_RETRY_MS * 2 ** Math.min(this.attempt, 5),
      );
      this.setState({
        kind: "offline",
        retryAt: this.now() + delay,
        error: error instanceof Error ? error.message : String(error),
        fingerprint:
          seen.key === null
            ? (record?.fingerprint ?? null)
            : keyFingerprint(seen.key),
      });
      this.scheduleRetry(delay);
      throw error;
    }
  }
}

export class SealedHandshakeError extends Error {
  constructor(readonly outcome: "pending" | "rejected") {
    super(`sealed connection ${outcome}`);
    this.name = "SealedHandshakeError";
  }
}

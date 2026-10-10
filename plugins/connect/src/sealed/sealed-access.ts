import {
  SEALED_PROTOCOL_VERSION,
  base64UrlEncode,
  bytesEqual,
  deviceCodeAck,
  keyFingerprint,
  verifyDelegation,
  verifyDeviceCodeProof,
  type ClientAuthRequest,
  type DelegationProof,
  type HandshakeOutcome,
} from "@bb/sealed-channel";
import {
  plaintextStreamVerdict,
  type StreamGuardInput,
  type StreamGuardResult,
} from "@bb/tunnel-client";
import { z } from "zod";
import type {
  DeviceRegistry,
  RegisterDeviceOptions,
  SealedDeviceView,
} from "./devices.js";
import type { DeviceCodeIssuer } from "./device-codes.js";
import type { ServerIdentityStore } from "./identity.js";
import {
  SEALED_INFO_ROUTE_PATH,
  SEALED_ROUTE_PATH,
  type SealedDeviceCode,
  type SealedDeviceSummary,
  type SealedInfo,
  type SealedStatus,
} from "./types.js";

const MAX_PENDING_DEVICES = 20;

export const SEALED_POLICY_KV_KEY = "sealed-policy";

const policyRecordSchema = z.object({
  requireEncryption: z.boolean(),
  generation: z.number().int().nonnegative().optional(),
});

export interface SealedPolicyStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface SealedAccessOptions {
  identity: ServerIdentityStore;
  devices: DeviceRegistry;
  codes: DeviceCodeIssuer;
  policy: SealedPolicyStore;
  onChange?: () => void;
  onRequired?: () => void;
  log?: { warn(message: string): void };
  now?: () => number;
}

interface ActiveChannel {
  deviceId: string;
  realtimeStreams: number;
}

export class SealedAccess {
  private readonly channels = new Map<object, ActiveChannel>();
  private readonly now: () => number;
  private requiredCache = false;
  private generation = 0;
  private hasPolicyRecord = false;
  private transition: Promise<void> = Promise.resolve();

  constructor(private readonly options: SealedAccessOptions) {
    this.now = options.now ?? Date.now;
  }

  async load(): Promise<void> {
    const raw = await this.options.policy.get<unknown>(SEALED_POLICY_KV_KEY);
    if (raw === undefined || raw === null) {
      this.requiredCache = false;
      this.generation = 0;
      this.hasPolicyRecord = false;
      return;
    }
    this.hasPolicyRecord = true;
    const parsed = policyRecordSchema.safeParse(raw);
    if (parsed.success) {
      this.requiredCache = parsed.data.requireEncryption;
      this.generation = parsed.data.generation ?? 0;
      return;
    }
    this.requiredCache = true;
    this.generation = this.now();
    this.options.log?.warn(
      "sealed policy record is unreadable; requiring sealed connections until it is set again",
    );
  }

  get required(): boolean {
    return this.requiredCache;
  }

  get hasPolicy(): boolean {
    return this.hasPolicyRecord;
  }

  guardStream(stream: StreamGuardInput): StreamGuardResult {
    return plaintextStreamVerdict(stream, this.required);
  }

  async info(): Promise<SealedInfo> {
    const identity = await this.options.identity.load();
    return {
      protocolVersion: SEALED_PROTOCOL_VERSION,
      publicKey: base64UrlEncode(identity.pair.publicKey),
      fingerprint: keyFingerprint(identity.pair.publicKey),
      required: this.required,
    };
  }

  async status(): Promise<SealedStatus> {
    const identity = await this.options.identity.load();
    const devices = await this.options.devices.list();
    return {
      protocolVersion: SEALED_PROTOCOL_VERSION,
      publicKey: base64UrlEncode(identity.pair.publicKey),
      fingerprint: keyFingerprint(identity.pair.publicKey),
      identityCreatedAt: identity.createdAt,
      required: this.required,
      activeChannels: this.channels.size,
      devices: devices.map((device) => this.summarize(device)),
    };
  }

  async listDevices(): Promise<SealedDeviceSummary[]> {
    return (await this.options.devices.list()).map((device) =>
      this.summarize(device),
    );
  }

  async approveDevice(id: string): Promise<SealedDeviceSummary | null> {
    const device = await this.options.devices.approve(
      id,
      "manual",
      this.generation,
    );
    this.options.onChange?.();
    return device === null ? null : this.summarize(device);
  }

  async revokeDevice(id: string): Promise<SealedDeviceSummary | null> {
    const device = await this.options.devices.revoke(id);
    this.disconnectDevice(id);
    await this.removeChildren(id);
    this.options.onChange?.();
    return device === null ? null : this.summarize(device);
  }

  async removeDevice(id: string): Promise<boolean> {
    await this.removeChildren(id);
    const removed = await this.options.devices.remove(id);
    this.disconnectDevice(id);
    this.options.onChange?.();
    return removed;
  }

  private async removeChildren(parentId: string): Promise<void> {
    for (const child of await this.options.devices.childrenOf(parentId)) {
      await this.options.devices.remove(child.id);
      this.disconnectDevice(child.id);
    }
  }

  async createDeviceCode(): Promise<SealedDeviceCode> {
    const identity = await this.options.identity.load();
    const code = this.options.codes.issue();
    return {
      ...code,
      serverKey: base64UrlEncode(identity.pair.publicKey),
      fingerprint: keyFingerprint(identity.pair.publicKey),
    };
  }

  async requireForNewPairing(): Promise<boolean> {
    if (this.hasPolicyRecord) return false;
    await this.setRequired(true);
    return true;
  }

  setRequired(required: boolean): Promise<SealedStatus> {
    const work = this.transition.then(async () => {
      const wasRequired = this.requiredCache;
      const generation =
        required && !wasRequired ? this.generation + 1 : this.generation;
      await this.options.policy.set(SEALED_POLICY_KV_KEY, {
        requireEncryption: required,
        generation,
      });
      this.requiredCache = required;
      this.generation = generation;
      this.hasPolicyRecord = true;
      if (required && !wasRequired) await this.onEncryptionRequired();
      this.options.onChange?.();
    });
    this.transition = work.then(
      () => undefined,
      () => undefined,
    );
    return work.then(() => this.status());
  }

  private staleApproval(device: SealedDeviceView): boolean {
    return (
      device.status === "approved" &&
      this.required &&
      device.policyGeneration < this.generation
    );
  }

  async onEncryptionRequired(): Promise<number> {
    this.options.onRequired?.();
    let demoted = 0;
    for (const device of await this.options.devices.list()) {
      if (device.status !== "approved" || device.parentId !== null) continue;
      await this.options.devices.demote(device.id);
      await this.removeChildren(device.id);
      this.disconnectDevice(device.id);
      demoted += 1;
    }
    this.options.onChange?.();
    return demoted;
  }

  async rotateIdentity(): Promise<SealedStatus> {
    await this.options.identity.rotate();
    for (const [handle] of [...this.channels]) {
      this.channelClosers.get(handle)?.(4001, "server identity rotated");
    }
    this.options.onChange?.();
    return this.status();
  }

  async serverIdentity() {
    return (await this.options.identity.load()).pair;
  }

  async authorize(request: ClientAuthRequest): Promise<HandshakeOutcome> {
    await this.transition;
    const { devices } = this.options;
    let existing = await devices.findByPublicKey(request.device.publicKey);
    if (existing?.status === "revoked") {
      return { status: "rejected", deviceId: existing.id, reason: "revoked" };
    }
    if (existing !== null && this.staleApproval(existing)) {
      existing = await devices.demote(existing.id);
      if (existing !== null) {
        await this.removeChildren(existing.id);
        this.options.onChange?.();
      }
    }
    const proof = request.proof;
    if (proof?.kind === "device-code") {
      const code = this.options.codes.consumeMatching((candidate) =>
        verifyDeviceCodeProof(candidate, proof, request.transcript),
      );
      if (code === null) {
        return {
          status: "rejected",
          deviceId: request.deviceId,
          reason: "invalid-code",
        };
      }
      const device = await this.enroll(request.device, "device-code", {
        parentId: null,
        delegationExpiresAt: null,
      });
      if (device === null) {
        return {
          status: "rejected",
          deviceId: request.deviceId,
          reason: "revoked",
        };
      }
      this.options.onChange?.();
      return {
        status: "ok",
        deviceId: device.id,
        codeAck: deviceCodeAck(code, request.transcript),
      };
    }
    if (existing?.status === "approved" && existing.parentId === null) {
      const refreshed = await devices.register(
        request.device,
        "approved",
        existing.approvedVia,
      );
      if (refreshed.status !== "approved") {
        return {
          status: "rejected",
          deviceId: existing.id,
          reason: "revoked",
        };
      }
      return { status: "ok", deviceId: existing.id };
    }
    if (
      proof?.kind === "delegation" ||
      (existing !== null && existing.parentId !== null)
    ) {
      return this.authorizeDelegated(request, proof);
    }
    if (!this.required) {
      const device = await this.enroll(request.device, "account-gate");
      if (device === null) {
        return {
          status: "rejected",
          deviceId: request.deviceId,
          reason: "revoked",
        };
      }
      await this.transition;
      if (this.staleApproval(device)) {
        await devices.demote(device.id);
        this.options.onChange?.();
        return { status: "pending", deviceId: device.id };
      }
      this.options.onChange?.();
      return { status: "ok", deviceId: device.id };
    }
    if (existing === null) await this.evictStalePending();
    const device = await devices.register(request.device, "pending", null);
    if (existing === null) this.options.onChange?.();
    return { status: "pending", deviceId: device.id };
  }

  private async evictStalePending(): Promise<void> {
    const pending = (await this.options.devices.list())
      .filter((device) => device.status === "pending")
      .sort(
        (a, b) => (a.lastSeenAt ?? a.createdAt) - (b.lastSeenAt ?? b.createdAt),
      );
    const excess = pending.length - (MAX_PENDING_DEVICES - 1);
    for (const device of pending.slice(0, Math.max(0, excess))) {
      await this.options.devices.remove(device.id);
    }
  }

  private async authorizeDelegated(
    request: ClientAuthRequest,
    proof: ClientAuthRequest["proof"],
  ): Promise<HandshakeOutcome> {
    const { devices } = this.options;
    const rejected: HandshakeOutcome = {
      status: "rejected",
      deviceId: request.deviceId,
      reason: "invalid-delegation",
    };
    if (proof?.kind !== "delegation") return rejected;
    const delegation: DelegationProof = proof;
    let parent = await devices.findByPublicKey(delegation.parentPublicKey);
    if (parent !== null && this.staleApproval(parent)) {
      parent = await devices.demote(parent.id);
      if (parent !== null) await this.removeChildren(parent.id);
      this.options.onChange?.();
    }
    if (
      parent === null ||
      parent.status !== "approved" ||
      parent.parentId !== null ||
      !verifyDelegation(
        delegation,
        request.device.publicKey,
        request.serverPublicKey,
        this.now(),
      )
    ) {
      return rejected;
    }
    const device = await this.enroll(
      {
        ...request.device,
        name: `${request.device.name} (via ${parent.name})`,
      },
      "delegation",
      { parentId: parent.id, delegationExpiresAt: delegation.expiresAt },
    );
    if (device === null) return rejected;
    this.options.onChange?.();
    return { status: "ok", deviceId: device.id };
  }

  private async enroll(
    device: ClientAuthRequest["device"],
    approvedVia: NonNullable<SealedDeviceView["approvedVia"]>,
    options?: RegisterDeviceOptions,
  ): Promise<SealedDeviceView | null> {
    const registered = await this.options.devices.register(
      device,
      "approved",
      approvedVia,
      { ...options, generation: this.generation },
    );
    if (registered.status === "approved") return registered;
    return this.options.devices.approve(
      registered.id,
      approvedVia,
      this.generation,
    );
  }

  private readonly channelClosers = new Map<
    object,
    (code: number, reason: string) => void
  >();
  private readonly channelTimers = new Map<
    object,
    ReturnType<typeof setTimeout>
  >();

  async channelOpened(
    handle: object,
    deviceId: string,
    serverPublicKey: Uint8Array,
    close: (code: number, reason: string) => void,
  ): Promise<boolean> {
    this.channels.set(handle, { deviceId, realtimeStreams: 0 });
    this.channelClosers.set(handle, close);
    await this.transition;
    const admitted = await this.admit(handle, deviceId, serverPublicKey, close);
    this.options.onChange?.();
    return admitted;
  }

  private async admit(
    handle: object,
    deviceId: string,
    serverPublicKey: Uint8Array,
    close: (code: number, reason: string) => void,
  ): Promise<boolean> {
    const device = await this.options.devices.get(deviceId);
    {
      const identity = await this.options.identity.load();
      if (!bytesEqual(identity.pair.publicKey, serverPublicKey)) {
        close(4001, "server identity rotated");
        return false;
      }
      if (device?.status !== "approved" || this.staleApproval(device)) {
        close(4002, "device revoked");
        return false;
      }
      if (device.parentId !== null) {
        const parent = await this.options.devices.get(device.parentId);
        if (parent?.status !== "approved" || this.staleApproval(parent)) {
          close(4002, "device revoked");
          return false;
        }
      }
      if (device.delegationExpiresAt !== null) {
        const remaining = device.delegationExpiresAt - this.now();
        const timer = setTimeout(
          () => {
            if (this.channels.has(handle)) close(4003, "delegation expired");
          },
          Math.max(0, remaining),
        );
        timer.unref?.();
        this.channelTimers.set(handle, timer);
      }
      void this.options.devices.touch(deviceId);
      return true;
    }
  }

  channelClosed(handle: object): void {
    if (!this.channels.delete(handle)) return;
    this.channelClosers.delete(handle);
    const timer = this.channelTimers.get(handle);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.channelTimers.delete(handle);
    }
    this.options.onChange?.();
  }

  channelRealtimeStreams(handle: object, count: number): void {
    const channel = this.channels.get(handle);
    if (channel === undefined) return;
    channel.realtimeStreams = count;
  }

  get remoteClients(): number {
    let total = 0;
    for (const channel of this.channels.values()) {
      total += channel.realtimeStreams;
    }
    return total;
  }

  get activeChannels(): number {
    return this.channels.size;
  }

  disconnectAll(code = 1001, reason = "bb connect stopped"): void {
    for (const [handle] of [...this.channels]) {
      this.channelClosers.get(handle)?.(code, reason);
    }
  }

  private disconnectDevice(deviceId: string): void {
    for (const [handle, channel] of [...this.channels]) {
      if (channel.deviceId === deviceId) {
        this.channelClosers.get(handle)?.(4002, "device revoked");
      }
    }
  }

  private summarize(device: SealedDeviceView): SealedDeviceSummary {
    let connected = false;
    for (const channel of this.channels.values()) {
      if (channel.deviceId === device.id) connected = true;
    }
    return {
      id: device.id,
      name: device.name,
      surface: device.surface,
      status: device.status,
      fingerprint: device.fingerprint,
      createdAt: device.createdAt,
      approvedAt: device.approvedAt,
      revokedAt: device.revokedAt,
      lastSeenAt: device.lastSeenAt,
      connected,
      parentId: device.parentId,
      approvedVia: device.approvedVia,
    };
  }
}

export { SEALED_INFO_ROUTE_PATH, SEALED_ROUTE_PATH, plaintextStreamVerdict };

import { z } from "zod";
import {
  base64UrlDecode,
  base64UrlEncode,
  bytesEqual,
  concatBytes,
  readUint64BE,
  utf8Decode,
  utf8Encode,
  writeUint64BE,
} from "./bytes.js";
import {
  AEAD_TAG_BYTES,
  PUBLIC_KEY_BYTES,
  SEALED_PROTOCOL_VERSION,
  SIGNATURE_BYTES,
  aeadOpen,
  aeadSeal,
  deriveKey,
  deviceIdFromPublicKey,
  generateEphemeralKeyPair,
  isValidPublicKey,
  labeledHash,
  mac,
  randomNonceBytes,
  sharedSecret,
  sign,
  verify,
  type EphemeralKeyPair,
  type SigningKeyPair,
} from "./crypto.js";

export const MESSAGE_KIND = {
  clientHello: 1,
  serverHello: 2,
  clientAuth: 3,
  serverResult: 4,
  data: 5,
} as const;

export const DEVICE_SURFACES = [
  "browser",
  "desktop",
  "mobile",
  "mobile-webview",
  "cli",
  "other",
] as const;
export type DeviceSurface = (typeof DEVICE_SURFACES)[number];

export const DEVICE_NAME_MAX_LENGTH = 80;
export const DEVICE_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u;
export const DELEGATION_MAX_TTL_MS = 24 * 60 * 60 * 1000;

export interface DeviceIdentity {
  readonly publicKey: Uint8Array;
  signClientAuth(transcript: Uint8Array): Promise<Uint8Array>;
  signDelegation?(
    childPublicKey: Uint8Array,
    expiresAt: number,
    serverPublicKey: Uint8Array,
  ): Promise<Uint8Array>;
}

export function clientAuthMessage(
  transcript: Uint8Array,
  devicePublicKey: Uint8Array,
): Uint8Array {
  return labeledHash("client-auth", transcript, devicePublicKey);
}

export function normalizeDeviceCode(raw: string): string | null {
  const compact = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "");
  if (compact.length !== 12) return null;
  const formatted = `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8)}`;
  return DEVICE_CODE_PATTERN.test(formatted) ? formatted : null;
}

export function deviceCodeMac(
  code: string,
  transcript: Uint8Array,
  role: "client" | "server",
): Uint8Array {
  return mac(
    labeledHash("device-code-key", utf8Encode(code)),
    labeledHash(`device-code-${role}`, transcript),
  );
}

export interface DeviceDescriptor {
  publicKey: Uint8Array;
  name: string;
  surface: DeviceSurface;
}

export interface DelegationProof {
  kind: "delegation";
  parentPublicKey: Uint8Array;
  expiresAt: number;
  signature: Uint8Array;
}

export type AuthProof =
  | { kind: "device-code"; mac: Uint8Array }
  | DelegationProof;

export type DelegationProvider = (
  serverPublicKey: Uint8Array,
) => Promise<DelegationProof | null> | DelegationProof | null;

export const REJECT_REASONS = [
  "revoked",
  "unknown-device",
  "invalid-code",
  "invalid-signature",
  "invalid-delegation",
  "encryption-disabled",
  "protocol",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export type HandshakeOutcome =
  | { status: "ok"; deviceId: string; codeAck?: string }
  | { status: "pending"; deviceId: string }
  | { status: "rejected"; deviceId: string | null; reason: RejectReason };

export class SealedProtocolError extends Error {
  constructor(message: string) {
    super(`sealed-channel: ${message}`);
    this.name = "SealedProtocolError";
  }
}

export class SealedDeviceCodeError extends SealedProtocolError {
  constructor(readonly outcome: "ok" | "pending" | "rejected") {
    super(
      outcome === "ok"
        ? "server did not prove knowledge of the device code"
        : `server answered ${outcome} without proving the device code; it may not be the bb you meant to pair with`,
    );
    this.name = "SealedDeviceCodeError";
  }
}

const clientHelloSchema = z
  .object({
    v: z.literal(SEALED_PROTOCOL_VERSION),
    ephemeral: z.string().min(1),
    nonce: z.string().min(1),
  })
  .strict();

const serverHelloSecretSchema = z
  .object({
    identity: z.string().min(1),
    signature: z.string().min(1),
  })
  .strict();

const proofSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("device-code"), mac: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("delegation"),
      parentPublicKey: z.string().min(1),
      expiresAt: z.number().int().positive(),
      signature: z.string().min(1),
    })
    .strict(),
]);

const clientAuthSchema = z
  .object({
    device: z
      .object({
        publicKey: z.string().min(1),
        name: z.string().min(1).max(DEVICE_NAME_MAX_LENGTH),
        surface: z.enum(DEVICE_SURFACES),
      })
      .strict(),
    signature: z.string().min(1),
    proof: proofSchema.optional(),
  })
  .strict();

const serverResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ok"),
      deviceId: z.string().min(1),
      codeAck: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({ status: z.literal("pending"), deviceId: z.string().min(1) })
    .strict(),
  z
    .object({
      status: z.literal("rejected"),
      deviceId: z.string().min(1).nullable(),
      reason: z.enum(REJECT_REASONS),
    })
    .strict(),
]);

function kindByte(kind: number): Uint8Array {
  return new Uint8Array([kind]);
}

function jsonBytes(value: unknown): Uint8Array {
  return utf8Encode(JSON.stringify(value));
}

function parseJson<T>(
  schema: z.ZodType<T>,
  bytes: Uint8Array,
  what: string,
): T {
  let raw: unknown;
  try {
    raw = JSON.parse(utf8Decode(bytes));
  } catch {
    throw new SealedProtocolError(`malformed ${what}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new SealedProtocolError(`invalid ${what}`);
  return parsed.data;
}

export function messageKind(bytes: Uint8Array): number | null {
  return bytes.length === 0 ? null : (bytes[0] ?? null);
}

function expectKind(bytes: Uint8Array, kind: number, what: string): Uint8Array {
  if (messageKind(bytes) !== kind) {
    throw new SealedProtocolError(`expected ${what}`);
  }
  return bytes.subarray(1);
}

export function delegationMessage(
  childPublicKey: Uint8Array,
  expiresAt: number,
  serverPublicKey: Uint8Array,
): Uint8Array {
  const expiry = new Uint8Array(8);
  writeUint64BE(expiresAt, expiry, 0);
  return labeledHash("delegate", childPublicKey, expiry, serverPublicKey);
}

interface HandshakeKeys {
  shared: Uint8Array;
  transcript: Uint8Array;
  clientToServer: Uint8Array;
  serverToClient: Uint8Array;
}

function handshakeKeys(
  shared: Uint8Array,
  clientHello: Uint8Array,
  serverEphemeral: Uint8Array,
): HandshakeKeys {
  const transcript = labeledHash("hello", clientHello, serverEphemeral);
  return {
    shared,
    transcript,
    clientToServer: deriveKey(shared, transcript, "hs-c2s"),
    serverToClient: deriveKey(shared, transcript, "hs-s2c"),
  };
}

export class SealedSession {
  private sendCounter = 0;
  private receiveCounter = 0;

  constructor(
    private readonly sendKey: Uint8Array,
    private readonly receiveKey: Uint8Array,
  ) {}

  seal(plaintext: Uint8Array): Uint8Array {
    const counter = this.sendCounter++;
    const header = new Uint8Array(9);
    header[0] = MESSAGE_KIND.data;
    writeUint64BE(counter, header, 1);
    return concatBytes(
      header,
      aeadSeal(this.sendKey, counter, plaintext, header),
    );
  }

  open(message: Uint8Array): Uint8Array {
    if (
      messageKind(message) !== MESSAGE_KIND.data ||
      message.length < 9 + AEAD_TAG_BYTES
    ) {
      throw new SealedProtocolError("expected data message");
    }
    const counter = readUint64BE(message, 1);
    if (counter !== this.receiveCounter) {
      throw new SealedProtocolError("data message out of order");
    }
    const plaintext = aeadOpen(
      this.receiveKey,
      counter,
      message.subarray(9),
      message.subarray(0, 9),
    );
    if (plaintext === null) {
      throw new SealedProtocolError("data message failed authentication");
    }
    this.receiveCounter += 1;
    return plaintext;
  }
}

function trafficSession(
  keys: HandshakeKeys,
  clientAuth: Uint8Array,
  role: "client" | "server",
): SealedSession {
  const transcript = labeledHash("traffic", keys.transcript, clientAuth);
  const clientToServer = deriveKey(keys.shared, transcript, "c2s");
  const serverToClient = deriveKey(keys.shared, transcript, "s2c");
  return role === "client"
    ? new SealedSession(clientToServer, serverToClient)
    : new SealedSession(serverToClient, clientToServer);
}

export interface ClientHandshakeOptions {
  device: DeviceIdentity;
  deviceName: string;
  surface: DeviceSurface;
  deviceCode?: string;
  delegation?: DelegationProvider;
}

export interface ServerIdentityInfo {
  publicKey: Uint8Array;
}

export class ClientHandshake {
  private readonly ephemeral: EphemeralKeyPair = generateEphemeralKeyPair();
  private clientHello: Uint8Array | null = null;
  private keys: HandshakeKeys | null = null;
  private serverIdentity: Uint8Array | null = null;
  private clientAuth: Uint8Array | null = null;
  private identityTranscript: Uint8Array | null = null;
  private usedCode: string | null = null;

  constructor(private readonly options: ClientHandshakeOptions) {}

  start(): Uint8Array {
    const body = jsonBytes({
      v: SEALED_PROTOCOL_VERSION,
      ephemeral: base64UrlEncode(this.ephemeral.publicKey),
      nonce: base64UrlEncode(randomNonceBytes(16)),
    });
    this.clientHello = concatBytes(kindByte(MESSAGE_KIND.clientHello), body);
    return this.clientHello;
  }

  onServerHello(message: Uint8Array): ServerIdentityInfo {
    if (this.clientHello === null) {
      throw new SealedProtocolError("handshake not started");
    }
    const payload = expectKind(
      message,
      MESSAGE_KIND.serverHello,
      "server hello",
    );
    if (payload.length < PUBLIC_KEY_BYTES + AEAD_TAG_BYTES) {
      throw new SealedProtocolError("server hello too short");
    }
    const serverEphemeral = payload.subarray(0, PUBLIC_KEY_BYTES);
    const keys = handshakeKeys(
      sharedSecret(this.ephemeral.secretKey, serverEphemeral),
      this.clientHello,
      serverEphemeral,
    );
    const secret = aeadOpen(
      keys.serverToClient,
      0,
      payload.subarray(PUBLIC_KEY_BYTES),
      kindByte(MESSAGE_KIND.serverHello),
    );
    if (secret === null) {
      throw new SealedProtocolError("server hello failed authentication");
    }
    const parsed = parseJson(serverHelloSecretSchema, secret, "server hello");
    const identity = base64UrlDecode(parsed.identity);
    const signature = base64UrlDecode(parsed.signature);
    if (
      !isValidPublicKey(identity) ||
      signature.length !== SIGNATURE_BYTES ||
      !verify(signature, labeledHash("server-auth", keys.transcript), identity)
    ) {
      throw new SealedProtocolError("server identity signature invalid");
    }
    this.keys = keys;
    this.serverIdentity = identity;
    return { publicKey: identity };
  }

  async createClientAuth(): Promise<Uint8Array> {
    if (this.keys === null || this.serverIdentity === null) {
      throw new SealedProtocolError("server hello not processed");
    }
    const transcript = labeledHash(
      "identity",
      this.keys.transcript,
      this.serverIdentity,
    );
    this.identityTranscript = transcript;
    const { device } = this.options;
    const signature = await device.signClientAuth(transcript);
    let proof: AuthProof | null = null;
    const code =
      this.options.deviceCode === undefined
        ? null
        : normalizeDeviceCode(this.options.deviceCode);
    if (this.options.deviceCode !== undefined && code === null) {
      throw new SealedProtocolError("device code is malformed");
    }
    if (code !== null) {
      this.usedCode = code;
      proof = {
        kind: "device-code",
        mac: deviceCodeMac(code, transcript, "client"),
      };
    } else if (this.options.delegation !== undefined) {
      proof = await this.options.delegation(this.serverIdentity);
    }
    const body = jsonBytes({
      device: {
        publicKey: base64UrlEncode(device.publicKey),
        name: this.options.deviceName.slice(0, DEVICE_NAME_MAX_LENGTH),
        surface: this.options.surface,
      },
      signature: base64UrlEncode(signature),
      ...(proof === null
        ? {}
        : proof.kind === "device-code"
          ? { proof: { kind: "device-code", mac: base64UrlEncode(proof.mac) } }
          : {
              proof: {
                kind: "delegation",
                parentPublicKey: base64UrlEncode(proof.parentPublicKey),
                expiresAt: proof.expiresAt,
                signature: base64UrlEncode(proof.signature),
              },
            }),
    });
    this.clientAuth = concatBytes(
      kindByte(MESSAGE_KIND.clientAuth),
      aeadSeal(
        this.keys.clientToServer,
        0,
        body,
        kindByte(MESSAGE_KIND.clientAuth),
      ),
    );
    return this.clientAuth;
  }

  onServerResult(message: Uint8Array): {
    outcome: HandshakeOutcome;
    session: SealedSession | null;
  } {
    if (this.keys === null || this.clientAuth === null) {
      throw new SealedProtocolError("client auth not sent");
    }
    const payload = expectKind(
      message,
      MESSAGE_KIND.serverResult,
      "server result",
    );
    const plaintext = aeadOpen(
      this.keys.serverToClient,
      1,
      payload,
      kindByte(MESSAGE_KIND.serverResult),
    );
    if (plaintext === null) {
      throw new SealedProtocolError("server result failed authentication");
    }
    const outcome = parseJson(serverResultSchema, plaintext, "server result");
    if (
      outcome.deviceId !== null &&
      outcome.deviceId !== deviceIdFromPublicKey(this.options.device.publicKey)
    ) {
      throw new SealedProtocolError("server result names a different device");
    }
    if (
      this.usedCode !== null &&
      (outcome.status !== "ok" ||
        outcome.codeAck === undefined ||
        this.identityTranscript === null ||
        !bytesEqual(
          base64UrlDecode(outcome.codeAck),
          deviceCodeMac(this.usedCode, this.identityTranscript, "server"),
        ))
    ) {
      throw new SealedDeviceCodeError(outcome.status);
    }
    return {
      outcome,
      session:
        outcome.status === "ok"
          ? trafficSession(this.keys, this.clientAuth, "client")
          : null,
    };
  }
}

export interface ClientAuthRequest {
  device: DeviceDescriptor;
  deviceId: string;
  proof: AuthProof | null;
  transcript: Uint8Array;
  serverPublicKey: Uint8Array;
}

export class ServerHandshake {
  private readonly ephemeral: EphemeralKeyPair = generateEphemeralKeyPair();
  private keys: HandshakeKeys | null = null;
  private clientAuth: Uint8Array | null = null;

  constructor(private readonly identity: SigningKeyPair) {}

  onClientHello(message: Uint8Array): Uint8Array {
    const payload = expectKind(
      message,
      MESSAGE_KIND.clientHello,
      "client hello",
    );
    const hello = parseJson(clientHelloSchema, payload, "client hello");
    const clientEphemeral = base64UrlDecode(hello.ephemeral);
    if (clientEphemeral.length !== PUBLIC_KEY_BYTES) {
      throw new SealedProtocolError("client ephemeral key invalid");
    }
    const keys = handshakeKeys(
      sharedSecret(this.ephemeral.secretKey, clientEphemeral),
      message,
      this.ephemeral.publicKey,
    );
    this.keys = keys;
    const secret = jsonBytes({
      identity: base64UrlEncode(this.identity.publicKey),
      signature: base64UrlEncode(
        sign(
          labeledHash("server-auth", keys.transcript),
          this.identity.secretKey,
        ),
      ),
    });
    return concatBytes(
      kindByte(MESSAGE_KIND.serverHello),
      this.ephemeral.publicKey,
      aeadSeal(
        keys.serverToClient,
        0,
        secret,
        kindByte(MESSAGE_KIND.serverHello),
      ),
    );
  }

  onClientAuth(message: Uint8Array): ClientAuthRequest {
    if (this.keys === null) {
      throw new SealedProtocolError("client hello not processed");
    }
    const payload = expectKind(message, MESSAGE_KIND.clientAuth, "client auth");
    const plaintext = aeadOpen(
      this.keys.clientToServer,
      0,
      payload,
      kindByte(MESSAGE_KIND.clientAuth),
    );
    if (plaintext === null) {
      throw new SealedProtocolError("client auth failed authentication");
    }
    const auth = parseJson(clientAuthSchema, plaintext, "client auth");
    const publicKey = base64UrlDecode(auth.device.publicKey);
    const signature = base64UrlDecode(auth.signature);
    const transcript = labeledHash(
      "identity",
      this.keys.transcript,
      this.identity.publicKey,
    );
    if (
      !isValidPublicKey(publicKey) ||
      !verify(signature, clientAuthMessage(transcript, publicKey), publicKey)
    ) {
      throw new SealedProtocolError("device signature invalid");
    }
    this.clientAuth = message;
    let proof: AuthProof | null = null;
    if (auth.proof?.kind === "device-code") {
      proof = { kind: "device-code", mac: base64UrlDecode(auth.proof.mac) };
    } else if (auth.proof?.kind === "delegation") {
      proof = {
        kind: "delegation",
        parentPublicKey: base64UrlDecode(auth.proof.parentPublicKey),
        expiresAt: auth.proof.expiresAt,
        signature: base64UrlDecode(auth.proof.signature),
      };
    }
    return {
      device: {
        publicKey,
        name: auth.device.name,
        surface: auth.device.surface,
      },
      deviceId: deviceIdFromPublicKey(publicKey),
      proof,
      transcript,
      serverPublicKey: this.identity.publicKey,
    };
  }

  createServerResult(outcome: HandshakeOutcome): {
    message: Uint8Array;
    session: SealedSession | null;
  } {
    if (this.keys === null || this.clientAuth === null) {
      throw new SealedProtocolError("client auth not processed");
    }
    const message = concatBytes(
      kindByte(MESSAGE_KIND.serverResult),
      aeadSeal(
        this.keys.serverToClient,
        1,
        jsonBytes(outcome),
        kindByte(MESSAGE_KIND.serverResult),
      ),
    );
    return {
      message,
      session:
        outcome.status === "ok"
          ? trafficSession(this.keys, this.clientAuth, "server")
          : null,
    };
  }
}

export function verifyDelegation(
  proof: DelegationProof,
  childPublicKey: Uint8Array,
  serverPublicKey: Uint8Array,
  now: number,
): boolean {
  if (!isValidPublicKey(proof.parentPublicKey)) return false;
  if (!Number.isFinite(proof.expiresAt) || proof.expiresAt <= now) return false;
  if (proof.expiresAt - now > DELEGATION_MAX_TTL_MS) return false;
  return verify(
    proof.signature,
    delegationMessage(childPublicKey, proof.expiresAt, serverPublicKey),
    proof.parentPublicKey,
  );
}

export async function createDelegation(
  parent: DeviceIdentity,
  childPublicKey: Uint8Array,
  expiresAt: number,
  serverPublicKey: Uint8Array,
): Promise<DelegationProof> {
  if (parent.signDelegation === undefined) {
    throw new SealedProtocolError("this device identity cannot delegate");
  }
  return {
    kind: "delegation",
    parentPublicKey: parent.publicKey,
    expiresAt,
    signature: await parent.signDelegation(
      childPublicKey,
      expiresAt,
      serverPublicKey,
    ),
  };
}

export function verifyDeviceCodeProof(
  code: string,
  proof: Extract<AuthProof, { kind: "device-code" }>,
  transcript: Uint8Array,
): boolean {
  return bytesEqual(proof.mac, deviceCodeMac(code, transcript, "client"));
}

export function deviceCodeAck(code: string, transcript: Uint8Array): string {
  return base64UrlEncode(deviceCodeMac(code, transcript, "server"));
}

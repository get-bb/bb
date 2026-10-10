import { sign as signWith, type SigningKeyPair } from "./crypto.js";
import {
  clientAuthMessage,
  delegationMessage,
  type DeviceIdentity,
} from "./protocol.js";
export {
  base64UrlDecode,
  base64UrlEncode,
  bytesEqual,
  hexEncode,
  toUint8Array,
  utf8Decode,
  utf8Encode,
} from "./bytes.js";
export {
  PUBLIC_KEY_BYTES,
  SEALED_PROTOCOL_VERSION,
  deserializeSigningKeyPair,
  deviceIdFromPublicKey,
  generateSigningKeyPair,
  isValidPublicKey,
  keyFingerprint,
  serializeSigningKeyPair,
  sign,
  signingKeyPairFromSecret,
  verify,
  type SerializedSigningKeyPair,
  type SigningKeyPair,
} from "./crypto.js";
export {
  DELEGATION_MAX_TTL_MS,
  DEVICE_CODE_PATTERN,
  DEVICE_NAME_MAX_LENGTH,
  DEVICE_SURFACES,
  REJECT_REASONS,
  SealedDeviceCodeError,
  SealedProtocolError,
  clientAuthMessage,
  createDelegation,
  delegationMessage,
  deviceCodeAck,
  normalizeDeviceCode,
  verifyDelegation,
  verifyDeviceCodeProof,
  type AuthProof,
  type ClientAuthRequest,
  type DelegationProof,
  type DelegationProvider,
  type DeviceDescriptor,
  type DeviceIdentity,
  type DeviceSurface,
  type HandshakeOutcome,
  type RejectReason,
} from "./protocol.js";
export {
  SealedChannelClient,
  SealedChannelClosedError,
  SealedServerKeyMismatchError,
  type ConnectSealedChannelOptions,
  type OpenSealedWebSocketArgs,
  type SealedChannelConnection,
  type SealedRequest,
  type SealedResponse,
  type SealedWebSocketStream,
  type ServerKeyDecision,
} from "./client.js";
export {
  sealedFetch,
  toFetchResponse,
  type SealedFetchOptions,
} from "./fetch.js";
export {
  decodeFrame,
  encodeFrame,
  type Frame,
  type HeaderPair,
} from "@bb/tunnel-contract";
export {
  acceptSealedChannel,
  type AcceptSealedChannelOptions,
  type EstablishedSealedChannel,
  type SealedChannelAcceptor,
  type SealedServerSocket,
  type SealedServerTransport,
} from "./server.js";
export type { SealedSocket, SealedSocketFactory } from "./transport.js";
export {
  createWebSocketSealedSocket,
  sealedEndpointUrl,
  type WebSocketConstructorLike,
  type WebSocketLike,
} from "./browser-socket.js";

export function localDeviceIdentity(pair: SigningKeyPair): DeviceIdentity {
  return {
    publicKey: pair.publicKey,
    signClientAuth: async (transcript) =>
      signWith(clientAuthMessage(transcript, pair.publicKey), pair.secretKey),
    signDelegation: async (childPublicKey, expiresAt, serverPublicKey) =>
      signWith(
        delegationMessage(childPublicKey, expiresAt, serverPublicKey),
        pair.secretKey,
      ),
  };
}

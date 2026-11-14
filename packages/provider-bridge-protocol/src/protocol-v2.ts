import type { InitializeResult } from "./handshake.js";
import {
  turnInputResultSchema,
  type SessionSettingsDeclaration,
  type TurnInputResult,
} from "./session-contract.js";
import { PROVIDER_BRIDGE_PROTOCOL_VERSION } from "./version.js";

export const PROVIDER_BRIDGE_PROTOCOL_V2 = 2 as const;

export type BridgeProtocolVersion =
  | typeof PROVIDER_BRIDGE_PROTOCOL_V2
  | typeof PROVIDER_BRIDGE_PROTOCOL_VERSION;

export type ResolvedBridgeProtocol =
  | {
      version: typeof PROVIDER_BRIDGE_PROTOCOL_VERSION;
      sessionSettings: SessionSettingsDeclaration;
    }
  | {
      version: typeof PROVIDER_BRIDGE_PROTOCOL_V2;
      claimedVersion: number;
    }
  | { version: null; claimedVersion: number };

export function resolveBridgeProtocol(
  result: InitializeResult,
): ResolvedBridgeProtocol {
  if (result.protocolVersion === PROVIDER_BRIDGE_PROTOCOL_VERSION) {
    const sessionSettings = result.capabilities.sessionSettings;
    return sessionSettings === undefined
      ? {
          version: PROVIDER_BRIDGE_PROTOCOL_V2,
          claimedVersion: result.protocolVersion,
        }
      : { version: PROVIDER_BRIDGE_PROTOCOL_VERSION, sessionSettings };
  }
  if (result.protocolVersion === PROVIDER_BRIDGE_PROTOCOL_V2) {
    return {
      version: PROVIDER_BRIDGE_PROTOCOL_V2,
      claimedVersion: result.protocolVersion,
    };
  }
  return { version: null, claimedVersion: result.protocolVersion };
}

export function describeSessionContractMissing(bridgeName: string): string {
  return `Provider bridge "${bridgeName}" answered initialize with protocol version ${PROVIDER_BRIDGE_PROTOCOL_VERSION} but without capabilities.sessionSettings, which protocol ${PROVIDER_BRIDGE_PROTOCOL_VERSION} requires, so bb runs it as a protocol ${PROVIDER_BRIDGE_PROTOCOL_V2} bridge. A bridge that implements the protocol ${PROVIDER_BRIDGE_PROTOCOL_VERSION} session contract declares capabilities.sessionSettings ({} keeps the defaults); a bridge that does not reports protocolVersion ${PROVIDER_BRIDGE_PROTOCOL_V2}.`;
}

const ACCEPTED: TurnInputResult = { admission: "accepted" };

export const protocolV2TurnInputResultSchema =
  turnInputResultSchema.catch(ACCEPTED);

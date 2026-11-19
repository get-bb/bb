import {
  accessCredentialListResponseSchema,
  accessPairingSchema,
  accessSessionResponseSchema,
  accessSignOutResponseSchema,
  redeemAccessPairingResponseSchema,
  revokeAccessCredentialResponseSchema,
  type AccessCredentialListResponse,
  type AccessPairing,
  type AccessSessionResponse,
  type AccessSignOutResponse,
  type RedeemAccessPairingRequest,
  type RedeemAccessPairingResponse,
  type RevokeAccessCredentialResponse,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export type {
  AccessCredential,
  AccessCredentialListResponse,
  AccessPairing,
  AccessSessionResponse,
  AccessSignOutResponse,
  RedeemAccessPairingRequest,
  RedeemAccessPairingResponse,
  RevokeAccessCredentialResponse,
} from "@bb/server-contract";

export interface AccessReadArgs {
  signal?: AbortSignal;
}

export interface ExperimentalAccessArea {
  session(args?: AccessReadArgs): Promise<AccessSessionResponse>;
  createPairing(): Promise<AccessPairing>;
  redeemPairing(
    args: RedeemAccessPairingRequest,
  ): Promise<RedeemAccessPairingResponse>;
  listCredentials(args?: AccessReadArgs): Promise<AccessCredentialListResponse>;
  revokeCredential(args: {
    id: string;
  }): Promise<RevokeAccessCredentialResponse>;
  signOut(): Promise<AccessSignOutResponse>;
}

export function createAccessArea(
  args: CreateSdkAreaArgs,
): ExperimentalAccessArea {
  const { transport } = args;
  const access = transport.api.v1.access;
  return {
    async session(input) {
      return accessSessionResponseSchema.parse(
        await transport.readJson(
          access.session.$get({}, ...signalRequestArgs(input?.signal)),
        ),
      );
    },
    async createPairing() {
      return accessPairingSchema.parse(
        await transport.readJson(access.pairings.$post()),
      );
    },
    async redeemPairing(input) {
      return redeemAccessPairingResponseSchema.parse(
        await transport.readJson(access.pairings.redeem.$post({ json: input })),
      );
    },
    async listCredentials(input) {
      return accessCredentialListResponseSchema.parse(
        await transport.readJson(
          access.credentials.$get({}, ...signalRequestArgs(input?.signal)),
        ),
      );
    },
    async revokeCredential(input) {
      return revokeAccessCredentialResponseSchema.parse(
        await transport.readJson(
          access.credentials[":id"].$delete({ param: { id: input.id } }),
        ),
      );
    },
    async signOut() {
      return accessSignOutResponseSchema.parse(
        await transport.readJson(access["sign-out"].$post()),
      );
    },
  };
}

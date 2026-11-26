import {
  accessCredentialListResponseSchema,
  accessPairingSchema,
  accessSessionResponseSchema,
  accessSignOutResponseSchema,
  redeemAccessPairingResponseSchema,
  revokeAccessCredentialResponseSchema,
  setRequireSignInResponseSchema,
  type AccessCredentialListResponse,
  type AccessPairing,
  type AccessSessionResponse,
  type AccessSignOutResponse,
  type RedeemAccessPairingRequest,
  type RedeemAccessPairingResponse,
  type RevokeAccessCredentialResponse,
  type SetRequireSignInResponse,
} from "@bb/server-contract";
import { createDpopProof, type DpopSigner } from "../dpop.js";
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
  SetRequireSignInResponse,
} from "@bb/server-contract";

export interface AccessReadArgs {
  signal?: AbortSignal;
}

export interface PairDeviceArgs {
  code: string;
  label: string;
  signer: DpopSigner;
}

export type PairedDevice = Extract<
  RedeemAccessPairingResponse,
  { kind: "device" }
>;

export interface ExperimentalAccessArea {
  session(args?: AccessReadArgs): Promise<AccessSessionResponse>;
  createPairing(): Promise<AccessPairing>;
  redeemPairing(
    args: RedeemAccessPairingRequest,
  ): Promise<RedeemAccessPairingResponse>;
  pairDevice(args: PairDeviceArgs): Promise<PairedDevice>;
  listCredentials(args?: AccessReadArgs): Promise<AccessCredentialListResponse>;
  revokeCredential(args: {
    id: string;
  }): Promise<RevokeAccessCredentialResponse>;
  signOut(): Promise<AccessSignOutResponse>;
  setRequireSignIn(args: {
    enabled: boolean;
  }): Promise<SetRequireSignInResponse>;
}

export function createAccessArea(
  args: CreateSdkAreaArgs,
): ExperimentalAccessArea {
  const { transport } = args;
  const access = () => transport.api.v1.access;
  return {
    async session(input) {
      return accessSessionResponseSchema.parse(
        await transport.readJson(
          access().session.$get({}, ...signalRequestArgs(input?.signal)),
        ),
      );
    },
    async createPairing() {
      return accessPairingSchema.parse(
        await transport.readJson(access().pairings.$post()),
      );
    },
    async redeemPairing(input) {
      return redeemAccessPairingResponseSchema.parse(
        await transport.readJson(
          access().pairings.redeem.$post({ json: input }),
        ),
      );
    },
    async pairDevice(input) {
      const redeem = access().pairings.redeem;
      const url = new URL(
        "/api/v1/access/pairings/redeem",
        transport.baseUrl === ""
          ? globalThis.location.origin
          : transport.baseUrl,
      ).toString();
      const proof = await createDpopProof({
        signer: input.signer,
        method: "POST",
        url,
      });
      const response = redeemAccessPairingResponseSchema.parse(
        await transport.readJson(
          redeem.$post(
            { json: { kind: "device", code: input.code, label: input.label } },
            { headers: { dpop: proof } },
          ),
        ),
      );
      if (response.kind !== "device") {
        throw new Error("The server answered a device pairing with a cookie");
      }
      return response;
    },
    async listCredentials(input) {
      return accessCredentialListResponseSchema.parse(
        await transport.readJson(
          access().credentials.$get({}, ...signalRequestArgs(input?.signal)),
        ),
      );
    },
    async revokeCredential(input) {
      return revokeAccessCredentialResponseSchema.parse(
        await transport.readJson(
          access().credentials[":id"].$delete({ param: { id: input.id } }),
        ),
      );
    },
    async signOut() {
      return accessSignOutResponseSchema.parse(
        await transport.readJson(access()["sign-out"].$post()),
      );
    },
    async setRequireSignIn(input) {
      return setRequireSignInResponseSchema.parse(
        await transport.readJson(
          access()["require-sign-in"].$put({
            json: { enabled: input.enabled },
          }),
        ),
      );
    },
  };
}

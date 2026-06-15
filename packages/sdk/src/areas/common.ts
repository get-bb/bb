import type { PublicApiSchema } from "@bb/server-contract";
import type { BbSdkContext, BbSdkTransport } from "../transport.js";

export interface CreateSdkAreaArgs {
  context: BbSdkContext;
  transport: BbSdkTransport;
}

type PublicApiEndpointOutput<TEndpoint> = TEndpoint extends {
  status: infer Status;
  output: infer Output;
}
  ? Status extends SuccessfulHttpStatus
    ? Output
    : never
  : never;

type SuccessfulHttpStatus =
  | 200
  | 201
  | 202
  | 203
  | 204
  | 205
  | 206
  | 207
  | 208
  | 226;

export type PublicApiOutput<
  TPath extends keyof PublicApiSchema,
  TMethod extends keyof PublicApiSchema[TPath],
> = PublicApiEndpointOutput<PublicApiSchema[TPath][TMethod]>;

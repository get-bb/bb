import type { ConnectPairRequest } from "@bb/server-contract";
import type { CreateSdkAreaArgs, PublicApiOutput } from "./common.js";

export interface ConnectPairArgs extends ConnectPairRequest {}
export type ConnectStatusResult = PublicApiOutput<"/connect/status", "$get">;

export interface ConnectArea {
  pair(args: ConnectPairArgs): Promise<ConnectStatusResult>;
  status(): Promise<ConnectStatusResult>;
  disconnect(): Promise<ConnectStatusResult>;
}

export function createConnectArea(args: CreateSdkAreaArgs): ConnectArea {
  const { transport } = args;
  return {
    async pair(input) {
      return transport.readJson(
        transport.api.v1.connect.pair.$post({ json: input }),
      );
    },
    async status() {
      return transport.readJson(transport.api.v1.connect.status.$get());
    },
    async disconnect() {
      return transport.readJson(transport.api.v1.connect.disconnect.$post());
    },
  };
}

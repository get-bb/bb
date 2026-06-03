import type {
  ReplayCaptureListResponse,
  ReplayRunRequest,
  ReplayRunResponse,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs, OkResponse } from "./common.js";

export interface ReplayRunArgs extends ReplayRunRequest {
  captureId: string;
}

export interface ReplayDeleteArgs {
  captureId: string;
}

export interface ReplayOpenResponse {
  url: string;
}

export interface ReplayArea {
  delete(args: ReplayDeleteArgs): Promise<OkResponse>;
  list(): Promise<ReplayCaptureListResponse>;
  open(): ReplayOpenResponse;
  run(args: ReplayRunArgs): Promise<ReplayRunResponse>;
}

const REPLAY_LIST_URL = "http://localhost:5173/development-only/replay";

export function createReplayArea(args: CreateSdkAreaArgs): ReplayArea {
  const { transport } = args;
  return {
    async delete(input) {
      await transport.readVoid(
        transport.api.v1["development-only"].replay.captures[
          ":id"
        ].$delete({
          param: { id: input.captureId },
        }),
      );
      return { ok: true };
    },
    async list() {
      return transport.readJson(
        transport.api.v1["development-only"].replay.captures.$get(),
      );
    },
    open() {
      return { url: REPLAY_LIST_URL };
    },
    async run(input) {
      return transport.readJson(
        transport.api.v1["development-only"].replay.captures[
          ":id"
        ].runs.$post({
          param: { id: input.captureId },
          json: { speed: input.speed },
        }),
      );
    },
  };
}

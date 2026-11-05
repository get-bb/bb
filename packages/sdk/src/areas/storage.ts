import type { StorageDatabaseResponse } from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface ExperimentalStorageDatabaseArgs {
  signal?: AbortSignal;
}

export type ExperimentalStorageDatabaseResult = StorageDatabaseResponse;

export interface ExperimentalStorageArea {
  database(
    args?: ExperimentalStorageDatabaseArgs,
  ): Promise<ExperimentalStorageDatabaseResult>;
}

export function createStorageArea({
  transport,
}: CreateSdkAreaArgs): ExperimentalStorageArea {
  return {
    async database(input = {}) {
      return transport.readJson(
        transport.api.v1.storage.database.$get(
          {},
          ...signalRequestArgs(input.signal),
        ),
      );
    },
  };
}

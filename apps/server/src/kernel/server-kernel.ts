import {
  OperationError,
  createOperationKernel,
  type OperationCaller,
  type OperationKernel,
} from "@bb/operations";
import { publicOperations } from "@bb/server-contract";
import type { Context } from "hono";
import { ApiError } from "../errors.js";
import { getGateAuthKind } from "../request-context.js";

export interface ServerKernel {
  readonly kernel: OperationKernel<Context>;
  callerFor(context: Context): OperationCaller;
}

export function createServerKernel(): ServerKernel {
  const kernel = createOperationKernel<Context>();
  for (const operation of publicOperations().values()) {
    kernel.define(operation);
  }
  return {
    kernel,
    callerFor: (context) => ({
      user: getGateAuthKind(context) === "machine" ? "machine" : "owner",
    }),
  };
}

export function operationErrorToApiError(error: unknown): unknown {
  if (!(error instanceof OperationError)) return error;
  switch (error.code) {
    case "invalid_input":
      return new ApiError(400, "invalid_request", error.message);
    case "unimplemented":
      return new ApiError(501, "unimplemented", error.message);
  }
}

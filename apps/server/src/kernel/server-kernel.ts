import {
  OperationError,
  createOperationKernel,
  type OperationCaller,
  type OperationKernel,
} from "@bb/operations";
import { publicOperations } from "@bb/server-contract";
import type { Context } from "hono";
import { ApiError } from "../errors.js";
import type { ServerLogger } from "../types.js";
import {
  callerFromRequest,
  currentOperationCaller,
  runAsOperationCaller,
} from "./caller.js";

export interface ServerKernel {
  readonly kernel: OperationKernel<Context>;
  callerFor(context: Context): OperationCaller;
}

export function createServerKernel(logger: ServerLogger): ServerKernel {
  const kernel = createOperationKernel<Context>({
    currentCaller: currentOperationCaller,
    enter: runAsOperationCaller,
    warn: (message, fields) => logger.warn(fields, message),
  });
  for (const operation of publicOperations().values()) {
    kernel.define(operation);
  }
  return {
    kernel,
    callerFor: callerFromRequest,
  };
}

export function operationErrorToApiError(error: unknown): unknown {
  if (!(error instanceof OperationError)) return error;
  switch (error.code) {
    case "invalid_input":
      return new ApiError(400, "invalid_request", error.message);
    case "denied":
      return new ApiError(403, "denied_by_plugin", error.message, {
        details: { plugin: error.plugin },
      });
    case "unimplemented":
      return new ApiError(501, "unimplemented", error.message);
    case "unknown_operation":
      return new ApiError(404, "operation_not_found", error.message);
    case "invalid_output":
      return new ApiError(500, "internal_error", error.message);
  }
}

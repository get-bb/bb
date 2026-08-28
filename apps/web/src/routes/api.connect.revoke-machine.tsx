import { createFileRoute } from "@tanstack/react-router";
import { depsFromEnv, revokeMachineForServerCredential } from "@/server/api";
import { getEnv } from "@/server/env";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface RevokeMachineRequest {
  machineId: string | null;
}

function isJsonObject<T>(value: T): value is T & { [key: string]: JsonValue } {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isStringValue(value: JsonValue | undefined): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function parseRevokeMachineRequest<T>(value: T): RevokeMachineRequest | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const machineId = value.machineId;
  if (machineId === undefined) {
    return { machineId: null };
  }
  return isStringValue(machineId) ? { machineId } : null;
}

export const Route = createFileRoute("/api/connect/revoke-machine")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const credential = request.headers.get("x-bb-connect-machine") ?? "";
        const body = parseRevokeMachineRequest(
          await request.json().catch(() => ({})),
        );
        if (body === null || !body.machineId) {
          return Response.json(
            { error: "missing-machine-id" },
            { status: 400 },
          );
        }
        const result = await revokeMachineForServerCredential(
          depsFromEnv(getEnv()),
          credential,
          body.machineId,
        );
        if ("status" in result) {
          return Response.json(
            { error: result.error },
            { status: result.status },
          );
        }
        return Response.json(result);
      },
    },
  },
});

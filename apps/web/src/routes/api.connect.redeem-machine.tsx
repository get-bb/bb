import { createFileRoute } from "@tanstack/react-router";
import { depsFromEnv, redeemMachineCode } from "@/server/api";
import { getEnv } from "@/server/env";

type RedeemMachineRequestObject = {
  readonly [key: string]: RedeemMachineRequestValue;
};
type RedeemMachineRequestValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | RedeemMachineRequestValue[]
  | RedeemMachineRequestObject;

function isRedeemMachineRequestObject(
  value: RedeemMachineRequestValue,
): value is RedeemMachineRequestObject {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function parseRedeemMachineCode(body: string): string {
  let value: RedeemMachineRequestValue;
  try {
    value = JSON.parse(body);
  } catch {
    return "";
  }
  if (!isRedeemMachineRequestObject(value)) return "";
  const code = value.code;
  return code !== undefined &&
    Object.prototype.toString.call(code) === "[object String]" &&
    code === String(code)
    ? String(code)
    : "";
}

export const Route = createFileRoute("/api/connect/redeem-machine")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text().catch(() => "");
        const result = await redeemMachineCode(
          depsFromEnv(getEnv()),
          parseRedeemMachineCode(body),
        );
        if ("error" in result) {
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

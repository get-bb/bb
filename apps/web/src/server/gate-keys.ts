import { parseGateKeySet } from "@bb/tunnel-contract/next";
import type { Env } from "./env.js";

export const GATE_KEYS_CACHE_CONTROL = "public, max-age=300";

export function gateKeysResponse(env: Pick<Env, "GATE_PUBLIC_KEYS">): Response {
  const raw = env.GATE_PUBLIC_KEYS?.trim() ?? "";
  if (raw === "") return new Response("not found\n", { status: 404 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const keySet = parseGateKeySet(parsed);
  if (keySet === null) {
    console.error("bb-web: GATE_PUBLIC_KEYS is not a valid gate key set");
    return new Response("not found\n", { status: 404 });
  }
  return Response.json(keySet, {
    headers: { "cache-control": GATE_KEYS_CACHE_CONTROL },
  });
}

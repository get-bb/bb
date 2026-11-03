import type { IncomingHttpHeaders } from "node:http";
import type { ReplyHeaders } from "./reply.js";

export type HeaderPairs = [name: string, value: string][];

export function pairsFromRaw(raw: readonly string[]): HeaderPairs {
  const pairs: HeaderPairs = [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    pairs.push([raw[index] ?? "", raw[index + 1] ?? ""]);
  }
  return pairs;
}

export function pairsFromReply(headers: ReplyHeaders): HeaderPairs {
  const pairs: HeaderPairs = [];
  for (const [name, value] of Object.entries(headers)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      pairs.push([name, item]);
    }
  }
  return pairs;
}

export function getHeader(pairs: HeaderPairs, name: string): string | null {
  const lower = name.toLowerCase();
  const found = pairs.find(([key]) => key.toLowerCase() === lower);
  return found === undefined ? null : found[1];
}

export function hasHeader(pairs: HeaderPairs, name: string): boolean {
  return getHeader(pairs, name) !== null;
}

export function withoutHeaders(
  pairs: HeaderPairs,
  ...names: string[]
): HeaderPairs {
  const drop = new Set(names.map((name) => name.toLowerCase()));
  return pairs.filter(([key]) => !drop.has(key.toLowerCase()));
}

export function setHeader(
  pairs: HeaderPairs,
  name: string,
  value: string,
): HeaderPairs {
  return [...withoutHeaders(pairs, name), [name, value]];
}

export function appendVary(pairs: HeaderPairs, token: string): HeaderPairs {
  const current = getHeader(pairs, "vary");
  if (current === null) return [...pairs, ["vary", token]];
  const tokens = current.split(",").map((part) => part.trim().toLowerCase());
  if (tokens.includes("*") || tokens.includes(token.toLowerCase())) {
    return pairs;
  }
  return setHeader(pairs, "vary", `${current}, ${token}`);
}

export function single(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

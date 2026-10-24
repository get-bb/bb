import { describe, expect, it } from "vitest";
import {
  findTopLevelJsonFields,
  parseJsonField,
  replaceJsonField,
} from "./json-fields.js";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const keys = new Set(["model", "metadata"]);

function fieldsOf(text: string): Record<string, unknown> | null {
  const bytes = encode(text);
  const fields = findTopLevelJsonFields(bytes, keys);
  if (fields === null) return null;
  return Object.fromEntries(
    [...fields].map(([key, span]) => [key, parseJsonField(bytes, span)]),
  );
}

describe("findTopLevelJsonFields", () => {
  it.each([
    String.raw`{"model":"m","metadata":{"user_id":"u"}}`,
    ` \n{ "messages" : [ {"content":"} ] { \\\" ,"} , 1.5e3, true, null ], "model" : "m" ,\r\n"metadata":{"user_id":"u","nested":[{"a":"}"}]} }\t`,
    String.raw`{"system":"ünïcødé ☃ }","model":"m","metadata":{"user_id":"u"}}`,
    String.raw`{"model":"m","metadata":{"user_id":"u"},"tools":[[[]]],"max_tokens":32000}`,
    String.raw`{"model":"first","metadata":{"user_id":"u"},"model":"m"}`,
  ])("reads the top-level fields JSON.parse would see in %s", (text) => {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(fieldsOf(text)).toEqual({
      model: parsed.model,
      metadata: parsed.metadata,
    });
  });

  it("skips a UTF-8 byte order mark as TextDecoder does", () => {
    expect(fieldsOf('﻿{"model":"m"}')).toEqual({ model: "m" });
  });

  it("returns no fields for an empty object", () => {
    expect(fieldsOf(" { } ")).toEqual({});
  });

  it.each([
    "",
    "not-json",
    "[]",
    '"model"',
    '{"model":"m"',
    '{"model":"m",}',
    '{"model" "m"}',
    '{"model":}',
    '{"model":"m"} trailing',
    '{"model":"unterminated}',
    '{"messages":[{"a":1}',
    "{model:1}",
  ])("rejects %j, which is not a JSON object", (raw) => {
    expect(findTopLevelJsonFields(encode(raw), keys)).toBeNull();
  });
});

describe("replaceJsonField", () => {
  it("replaces only the field's bytes", () => {
    const text =
      '{ "metadata" : {"user_id":"old","extra":1} ,\n "messages":[{"content":"keep ☃ \\" exactly"}]}';
    const bytes = encode(text);
    const span = findTopLevelJsonFields(bytes, keys)?.get("metadata");
    if (span === undefined) throw new Error("metadata span missing");
    expect(
      decode(replaceJsonField(bytes, span, { user_id: "new", extra: 1 })),
    ).toBe(
      '{ "metadata" : {"user_id":"new","extra":1} ,\n "messages":[{"content":"keep ☃ \\" exactly"}]}',
    );
  });
});

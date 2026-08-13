import { describe, expect, it } from "vitest";
import { GdbMiParser, parseGdbMi } from "./mi.js";

describe("GDB/MI3 parser", () => {
  it("parses golden result, async, stream, tuple, and list records", () => {
    expect(parseGdbMi([
      '1^done,bkpt={number="1",addr="0x08000100",func="main"}',
      '*stopped,reason="breakpoint-hit",thread-id="1"',
      '=thread-created,id="2",group-id="i1"',
      '~"hello\\nworld"',
      '2^done,register-values=[{number="0",value="0x1"},{number="1",value="0x2"}]',
    ].join("\n"))).toEqual([
      {
        kind: "result", token: 1, class: "done",
        results: { bkpt: { number: "1", addr: "0x08000100", func: "main" } },
      },
      {
        kind: "async", token: null, asyncKind: "exec", class: "stopped",
        results: { reason: "breakpoint-hit", "thread-id": "1" },
      },
      {
        kind: "async", token: null, asyncKind: "notify", class: "thread-created",
        results: { id: "2", "group-id": "i1" },
      },
      { kind: "stream", stream: "console", text: "hello\nworld" },
      {
        kind: "result", token: 2, class: "done",
        results: {
          "register-values": [
            { number: "0", value: "0x1" },
            { number: "1", value: "0x2" },
          ],
        },
      },
    ]);
  });

  it("tolerates interleaving and recovers after malformed records", () => {
    const parser = new GdbMiParser();
    expect(parser.push('3^done,value="ok"\n*running,thread-id="all"\nBOGUS\n4')).toEqual([
      { kind: "result", token: 3, class: "done", results: { value: "ok" } },
      { kind: "async", token: null, asyncKind: "exec", class: "running", results: { "thread-id": "all" } },
      expect.objectContaining({ kind: "malformed", raw: "BOGUS" }),
    ]);
    expect(parser.push('^done,value="next"\n')).toEqual([
      { kind: "result", token: 4, class: "done", results: { value: "next" } },
    ]);
  });

  it("makes a truncated final record visible", () => {
    const parser = new GdbMiParser();
    expect(parser.push('5^done,value="half')).toEqual([]);
    expect(parser.finish()).toEqual([
      { kind: "malformed", raw: '5^done,value="half', error: "truncated MI record" },
    ]);
  });
});

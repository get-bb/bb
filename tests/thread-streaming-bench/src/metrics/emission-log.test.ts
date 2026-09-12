import { describe, expect, it } from "vitest";
import { parseEmissionLog } from "./emission-log.js";

const START =
  '{"event":"start","t":1000,"doc":"long-response","docChars":16500,"chunk":24,"interval":30}';

describe("parseEmissionLog", () => {
  it("parses JSONL events and skips blank lines", () => {
    const events = parseEmissionLog(
      `${START}\n{"event":"delta","t":1030,"chars":24}\n\n{"event":"complete","t":1500}\n`,
    );
    expect(events).toEqual([
      {
        event: "start",
        t: 1000,
        doc: "long-response",
        docChars: 16500,
        chunk: 24,
        interval: 30,
      },
      { event: "delta", t: 1030, chars: 24 },
      { event: "complete", t: 1500 },
    ]);
  });

  it("reports the line number of malformed JSON and invalid events", () => {
    expect(() => parseEmissionLog(`${START}\n{"event":"delta","t":`)).toThrow(
      "Emission log line 2 is not JSON",
    );
    expect(() =>
      parseEmissionLog(`${START}\n{"event":"delta","t":1,"chars":-1}`),
    ).toThrow("Emission log line 2 is not a valid event");
    expect(() => parseEmissionLog('{"event":"tick","t":1}')).toThrow(
      "Emission log line 1 is not a valid event",
    );
  });
});

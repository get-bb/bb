import { expect, it } from "vitest";
import {
  createSecretStreamRedactor,
  redactSecretText,
} from "./secret-redaction.js";

it.each(["first-line\nsecond-line", "first-line\r\nsecond-line"])(
  "matches LF and CRLF variants of %j across every chunk boundary",
  (secret) => {
    for (const printed of [
      "first-line\nsecond-line",
      "first-line\r\nsecond-line",
    ]) {
      const text = `before ${printed} after`;
      for (let split = 0; split <= text.length; split += 1) {
        const redactor = createSecretStreamRedactor([secret]);
        expect(
          redactor.push(text.slice(0, split)) +
            redactor.push(text.slice(split)) +
            redactor.flush(),
        ).toBe("before [redacted] after");
      }
    }
  },
);

it("retains overlapping prefixes without rewriting replacement markers", () => {
  const redactor = createSecretStreamRedactor(["abc", "abcdef", "redacted"]);
  expect(redactor.push("value abc")).toBe("value ");
  expect(redactor.push("def redacted!")).toBe("[redacted] [redacted]!");
  expect(redactor.flush()).toBe("");
});

it("hides an unfinished prefix at cancellation and retains secrets during rotation", () => {
  let secrets = ["old-token"];
  const redactor = createSecretStreamRedactor(() => secrets);
  expect(redactor.push("old-")).toBe("");
  secrets = ["new-token"];
  expect(redactor.push("token new-")).toBe("[redacted] ");
  expect(redactor.flush()).toBe("[redacted]");
});

it.each(["first-line\nsecond-line", "first-line\r\nsecond-line"])(
  "redacts complete multiline values without treating their suffix as an open stream: %j",
  (secret) => {
    const prefix = secret.slice(0, 8);
    for (const value of [
      "first-line\nsecond-line",
      "first-line\r\nsecond-line",
    ]) {
      expect(redactSecretText(`${value} /workspace/${prefix}`, [secret])).toBe(
        `[redacted] /workspace/${prefix}`,
      );
    }
  },
);

it("matches the longest complete secret without rewriting replacement markers", () => {
  expect(
    redactSecretText("abcdef abc ab redacted", [
      "abc",
      "abcdef",
      "redacted",
      "",
    ]),
  ).toBe("[redacted] [redacted] ab [redacted]");
});

it("matches CRLF secrets after a PTY inserts another carriage return", () => {
  const secret = "first-line\r\nsecond-line";
  const printed = secret.replaceAll("\n", "\r\n");
  expect(redactSecretText(`${printed} first-li`, [secret])).toBe(
    "[redacted] first-li",
  );
  const stream = createSecretStreamRedactor([secret]);
  expect(stream.push(printed) + stream.flush()).toBe("[redacted]");
});

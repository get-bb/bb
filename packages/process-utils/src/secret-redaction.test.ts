import { expect, it } from "vitest";
import { createSecretStreamRedactor } from "./secret-redaction.js";

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

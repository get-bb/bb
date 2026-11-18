import { expect, it } from "vitest";
import { threadVoiceCommandSchema } from "../src/thread-voice.js";
const start = {
  action: "start",
  sessionId: "11111111-1111-4111-8111-111111111111",
  sdp: "offer",
};
it("bounds caller startup values and rejects context updates on existing calls", () => {
  expect(
    threadVoiceCommandSchema.safeParse({ ...start, initialContext: "" })
      .success,
  ).toBe(true);
  expect(
    threadVoiceCommandSchema.safeParse({
      ...start,
      initialContext: "x".repeat(16001),
    }).success,
  ).toBe(false);
  expect(
    threadVoiceCommandSchema.safeParse({
      ...start,
      instructions: "x".repeat(8001),
    }).success,
  ).toBe(false);
  expect(
    threadVoiceCommandSchema.safeParse({ ...start, voice: "x".repeat(65) })
      .success,
  ).toBe(false);
  for (const action of ["keepAlive", "stop"])
    expect(
      threadVoiceCommandSchema.safeParse({
        action,
        sessionId: start.sessionId,
        initialContext: "late reference",
      }).success,
    ).toBe(false);
});

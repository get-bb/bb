import { BbHttpError } from "@bb/sdk/browser";
import { describe, expect, it } from "vitest";
import {
  buildVoiceTranscriptionRequest,
  isRecordingLongEnough,
  normalizeTranscript,
  parseVoiceTranscription,
  resolveVoiceErrorMessage,
  voiceRecordingFileFromUri,
} from "./voice-transcription";

describe("voice transcription", () => {
  it("builds the multipart request with an optional trimmed prompt before the file", () => {
    expect(
      buildVoiceTranscriptionRequest({
        serverUrl: "http://h/",
        file: voiceRecordingFileFromUri("file:///tmp/rec.m4a"),
        prompt: "  context ",
      }),
    ).toEqual({
      url: "http://h/api/v1/system/voice-transcription",
      fields: [
        ["prompt", "context"],
        [
          "file",
          {
            uri: "file:///tmp/rec.m4a",
            name: "recording.m4a",
            type: "audio/mp4",
          },
        ],
      ],
    });
    expect(
      buildVoiceTranscriptionRequest({
        serverUrl: "http://h",
        file: voiceRecordingFileFromUri("file:///a.caf"),
        prompt: "  ",
      }).fields,
    ).toEqual([
      [
        "file",
        { uri: "file:///a.caf", name: "recording.caf", type: "audio/x-caf" },
      ],
    ]);
  });

  it("enforces the one-second minimum and normalizes transcripts", () => {
    expect(isRecordingLongEnough(999)).toBe(false);
    expect(isRecordingLongEnough(1000)).toBe(true);
    expect(normalizeTranscript("  hello\n  world ")).toBe("hello world");
    expect(parseVoiceTranscription({ text: "hi" })).toBe("hi");
    expect(() => parseVoiceTranscription({})).toThrow();
  });

  it("maps failures like the web: server body, stripped HTTP prefix, abort", () => {
    expect(
      resolveVoiceErrorMessage(
        new BbHttpError({
          status: 400,
          code: null,
          message: "Audio too large",
          body: { error: "Audio too large" },
        }),
      ),
    ).toBe("Audio too large");
    expect(
      resolveVoiceErrorMessage(new Error("HTTP 500: <!doctype html><html>x")),
    ).toBe("Voice input failed");
    expect(resolveVoiceErrorMessage(new Error("HTTP 502: Bad gateway"))).toBe(
      "Bad gateway",
    );
    expect(resolveVoiceErrorMessage(new DOMException("x", "AbortError"))).toBe(
      "Voice capture was aborted",
    );
    expect(resolveVoiceErrorMessage(undefined)).toBe("Voice input failed");
  });
});

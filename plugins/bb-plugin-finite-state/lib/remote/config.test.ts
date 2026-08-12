import { describe, expect, it } from "vitest";
import { readRemoteConfig, type RemoteSettingValues } from "./config.js";

const defaults: RemoteSettingValues = {
  platformBaseUrl: "", platformToken: undefined, platformConcurrency: "8",
  asBaseUrl: "", asApiKey: undefined, asConcurrency: "8",
  forgeTransport: "disabled", forgeUrl: "", forgeCommand: "",
  forgeAuthToken: undefined, forgeConcurrency: "4",
};

describe("remote configuration", () => {
  it("normalizes blank secrets and rejects unlisted values to safe defaults", () => {
    expect(readRemoteConfig({
      ...defaults,
      platformBaseUrl: " https://platform.example/path ", platformToken: " token ",
      platformConcurrency: "999", forgeTransport: "arbitrary", forgeConcurrency: "16",
    })).toEqual({
      platformBaseUrl: "https://platform.example/path", platformToken: "token",
      asBaseUrl: null, asApiKey: null, forgeTransport: "disabled",
      forgeUrl: null, forgeCommand: null, forgeAuthToken: null,
      platformConcurrency: 8, asConcurrency: 8, forgeConcurrency: 4,
    });
  });
});

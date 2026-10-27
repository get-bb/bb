import { describe, expect, it } from "vitest";
import {
  displayPath,
  splitDestination,
  fitStem,
  rightmostSpan,
} from "./destination-label.js";

describe("splitDestination", () => {
  it.each([
    [
      "/srv/app/credentials/.env.local",
      { stem: ".env", extension: ".local", folder: "/srv/app/credentials" },
    ],
    [
      "/srv/credentials/droplet-monitor-production-service.env.local",
      {
        stem: "droplet-monitor-production-service",
        extension: ".env.local",
        folder: "/srv/credentials",
      },
    ],
    ["/srv/app/.env", { stem: ".env", extension: "", folder: "/srv/app" }],
    [
      "/srv/app/.env.production.local",
      { stem: ".env", extension: ".production.local", folder: "/srv/app" },
    ],
    [
      "/srv/app/api.env.production.local",
      { stem: "api", extension: ".env.production.local", folder: "/srv/app" },
    ],
    ["/.env", { stem: ".env", extension: "", folder: "/" }],
    ["C:\\app\\.env", { stem: ".env", extension: "", folder: "C:\\app" }],
    ["C:\\.env", { stem: ".env", extension: "", folder: "C:\\" }],
    ["/srv/app/", { stem: "/srv/app/", extension: "", folder: null }],
    ["secrets.env", { stem: "secrets", extension: ".env", folder: null }],
    [
      "/srv/app/config.prod.json",
      { stem: "config.prod", extension: ".json", folder: "/srv/app" },
    ],
  ])("splits %s", (path, parts) => {
    expect(splitDestination(path)).toEqual(parts);
  });
});

describe("fitStem", () => {
  const width = (text: string) => Array.from(text).length;

  it("keeps a name that fits whole", () => {
    expect(fitStem("credentials", 11, width)).toBe("credentials");
  });

  it.each([
    ["droplet-monitor-production-service", 12, "drople…rvice"],
    ["droplet-monitor-production-service", 4, "dr…e"],
    ["credentials", 8, "cred…als"],
    ["credentials", 1, "c…s"],
    ["envs", 2, "e…s"],
    ["api", 2, "api"],
    ["ab", 1, "ab"],
  ])("shortens %s in the middle to fit %s", (stem, available, text) => {
    expect(fitStem(stem, available, width)).toBe(text);
  });

  it("keeps graphemes whole while shortening", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const fitted = fitStem(
      `team-${family}-credentials-ok`,
      10,
      (text) => Array.from(new Intl.Segmenter().segment(text)).length,
    );
    expect(fitted).toBe(`team-…s-ok`);
    expect(
      fitStem(
        `${family}${family}${family}${family}`,
        2,
        (text) => Array.from(new Intl.Segmenter().segment(text)).length,
      ),
    ).toBe(`${family}…${family}`);
  });
});

describe("rightmostSpan", () => {
  it("spans the visually rightmost glyphs whatever their text order", () => {
    expect(
      rightmostSpan(
        [
          { left: 0, right: 8 },
          { left: 8, right: 12 },
          { left: 12, right: 20 },
        ],
        2,
      ),
    ).toBe(12);
    expect(
      rightmostSpan(
        [
          { left: 30, right: 40 },
          { left: 20, right: 30 },
          { left: 10, right: 20 },
          { left: 40, right: 40 },
        ],
        2,
      ),
    ).toBe(20);
  });

  it("returns null when nothing has width", () => {
    expect(rightmostSpan([{ left: 4, right: 4 }], 2)).toBeNull();
  });
});

describe("displayPath", () => {
  it.each([
    ["~/projects/app", "\u2066~/\u200eprojects/\u200eapp\u2069"],
    ["C:\\Users\\dev", "\u2066C:\\\u200eUsers\\\u200edev\u2069"],
    ["~", "\u2066~\u2069"],
  ])("isolates %s and marks each separator left-to-right", (path, label) => {
    expect(displayPath(path)).toBe(label);
  });
});

import { describe, expect, it } from "vitest";

import {
  addSavedUtmParams,
  pickUtmParams,
  readSavedUtm,
  rememberLatestUtm,
} from "./download-utm";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe("pickUtmParams", () => {
  it("keeps only non-empty utm params the download endpoint reads", () => {
    expect(
      pickUtmParams(
        "?utm_source=google&utm_campaign=x&utm_medium=&utm_id=7&category=ai",
      ).toString(),
    ).toBe("utm_source=google&utm_campaign=x");
  });
});

describe("addSavedUtmParams", () => {
  it("appends saved utm params after the existing placement", () => {
    expect(
      addSavedUtmParams(
        "?placement=hero",
        new URLSearchParams("utm_source=google&utm_campaign=x"),
      ),
    ).toBe("?placement=hero&utm_source=google&utm_campaign=x");
  });

  it("never mixes saved params into a link that already has utm params", () => {
    expect(
      addSavedUtmParams(
        "?utm_source=bing",
        new URLSearchParams("utm_source=google&utm_medium=cpc"),
      ),
    ).toBe("?utm_source=bing");
  });

  it("leaves a link unchanged when nothing is saved", () => {
    expect(addSavedUtmParams("?placement=nav", new URLSearchParams())).toBe(
      "?placement=nav",
    );
  });
});

describe("rememberLatestUtm", () => {
  it("keeps the most recent landing's full utm set for the session", () => {
    const storage = memoryStorage();
    rememberLatestUtm(storage, "?utm_source=newsletter&utm_campaign=launch");
    rememberLatestUtm(
      storage,
      "?utm_source=google&utm_medium=cpc&utm_campaign=brand",
    );
    rememberLatestUtm(storage, "?category=ai");
    expect(readSavedUtm(storage).toString()).toBe(
      "utm_source=google&utm_medium=cpc&utm_campaign=brand",
    );
  });
});

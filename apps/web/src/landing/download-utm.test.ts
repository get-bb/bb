import { describe, expect, it } from "vitest";

import {
  addMissingUtmParams,
  pickUtmParams,
  readSavedUtm,
  rememberFirstTouchUtm,
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

describe("addMissingUtmParams", () => {
  it("appends saved utm params after the existing placement", () => {
    expect(
      addMissingUtmParams(
        "?placement=hero",
        new URLSearchParams("utm_source=google&utm_campaign=x"),
      ),
    ).toBe("?placement=hero&utm_source=google&utm_campaign=x");
  });

  it("keeps params already on the link over saved ones", () => {
    expect(
      addMissingUtmParams(
        "?utm_source=bing&utm_medium=",
        new URLSearchParams("utm_source=google&utm_medium=cpc"),
      ),
    ).toBe("?utm_source=bing&utm_medium=cpc");
  });

  it("leaves a link without saved params unchanged", () => {
    expect(addMissingUtmParams("", new URLSearchParams())).toBe("");
  });
});

describe("rememberFirstTouchUtm", () => {
  it("keeps the first landing's utm params for the session", () => {
    const storage = memoryStorage();
    rememberFirstTouchUtm(storage, "?category=ai");
    rememberFirstTouchUtm(storage, "?utm_source=google&utm_campaign=x");
    rememberFirstTouchUtm(storage, "?utm_source=newsletter");
    expect(readSavedUtm(storage).toString()).toBe(
      "utm_source=google&utm_campaign=x",
    );
  });
});

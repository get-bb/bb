import { describe, expect, it } from "vitest";

import { consentRequiredForCountry, isAdClickLanding } from "./google-ads";

describe("consentRequiredForCountry", () => {
  it("skips the prompt only for the countries that need no consent", () => {
    expect(consentRequiredForCountry("US")).toBe(false);
    expect(consentRequiredForCountry("ca")).toBe(false);
    expect(consentRequiredForCountry("AU")).toBe(false);
    expect(consentRequiredForCountry("NZ")).toBe(false);
  });

  it("asks in the UK, the EU, and when the country is unknown", () => {
    expect(consentRequiredForCountry("GB")).toBe(true);
    expect(consentRequiredForCountry("IE")).toBe(true);
    expect(consentRequiredForCountry("DE")).toBe(true);
    expect(consentRequiredForCountry("XX")).toBe(true);
    expect(consentRequiredForCountry(null)).toBe(true);
  });
});

describe("isAdClickLanding", () => {
  it("recognizes Google ad click ids and ignores plain campaign tags", () => {
    expect(isAdClickLanding("?gclid=abc&utm_source=google")).toBe(true);
    expect(isAdClickLanding("?wbraid=abc")).toBe(true);
    expect(isAdClickLanding("?utm_source=google&utm_medium=cpc")).toBe(false);
    expect(isAdClickLanding("?gclid=")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCount,
  formatCvss,
  formatEpss,
  formatHash,
  formatIsoDate,
  formatPurl,
  formatRelativeDate,
  formatSeverity,
} from "./format.js";

describe("formatSeverity", () => {
  it("normalizes known severity labels", () => {
    expect(formatSeverity(" CRITICAL ")).toEqual({
      label: "Critical",
      severity: "critical",
    });
    expect(formatSeverity("none")).toEqual({ label: "None", severity: "none" });
  });

  it.each([null, undefined, "", "informational", "urgent"])(
    "returns unknown for unrecognized input %s",
    (value) => {
      expect(formatSeverity(value)).toEqual({ label: "Unknown", severity: "unknown" });
    },
  );
});

describe("numeric formatters", () => {
  it("formats CVSS boundaries and rejects invalid scores", () => {
    expect(formatCvss(0)).toBe("0.0");
    expect(formatCvss(4.26)).toBe("4.3");
    expect(formatCvss(10)).toBe("10.0");
    expect(formatCvss(-0.1)).toBe("—");
    expect(formatCvss(10.1)).toBe("—");
    expect(formatCvss(Number.NaN)).toBe("—");
  });

  it("formats EPSS as a one-decimal percentage", () => {
    expect(formatEpss(0)).toBe("0.0%");
    expect(formatEpss(0.1234)).toBe("12.3%");
    expect(formatEpss(1)).toBe("100.0%");
    expect(formatEpss(-0.01)).toBe("—");
    expect(formatEpss(1.01)).toBe("—");
    expect(formatEpss(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("formats IEC byte boundaries without locale state", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KiB");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(1024 ** 2)).toBe("1 MiB");
    expect(formatBytes(1024 ** 5)).toBe("1 PiB");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(1.5)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });

  it("groups nonnegative safe integer counts deterministically", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1_234_567)).toBe("1,234,567");
    expect(formatCount(-1)).toBe("—");
    expect(formatCount(1.5)).toBe("—");
    expect(formatCount(Number.MAX_SAFE_INTEGER + 1)).toBe("—");
  });
});

describe("date formatters", () => {
  const now = new Date("2026-08-12T12:00:00.000Z");

  it("formats strict ISO input as a UTC calendar date", () => {
    expect(formatIsoDate("2026-08-12")).toBe("2026-08-12");
    expect(formatIsoDate("2026-08-12T23:30:00-04:00")).toBe("2026-08-13");
    expect(formatIsoDate("2024-02-29T00:00:00Z")).toBe("2024-02-29");
  });

  it.each([
    null,
    undefined,
    "",
    "2026-02-30",
    "2026-08-12T12:00:00",
    "08/12/2026",
    "not-a-date",
  ])("rejects ambiguous or invalid date input %s", (value) => {
    expect(formatIsoDate(value)).toBe("—");
    expect(formatRelativeDate(value, now)).toBe("—");
  });

  it("formats compact past intervals and a deterministic absolute fallback", () => {
    expect(formatRelativeDate("2026-08-12T11:59:31Z", now)).toBe("just now");
    expect(formatRelativeDate("2026-08-12T11:55:00Z", now)).toBe("5m ago");
    expect(formatRelativeDate("2026-08-12T09:00:00Z", now)).toBe("3h ago");
    expect(formatRelativeDate("2026-08-10T12:00:00Z", now)).toBe("2d ago");
    expect(formatRelativeDate("2026-07-29T12:00:00Z", now)).toBe("2w ago");
    expect(formatRelativeDate("2026-06-01T12:00:00Z", now)).toBe("2026-06-01");
    expect(formatRelativeDate("2026-08-12T12:00:05Z", now)).toBe("just now");
    expect(formatRelativeDate("2026-08-12", new Date(Number.NaN))).toBe("—");
  });
});

describe("identifier formatters", () => {
  it("normalizes and truncates hexadecimal hashes", () => {
    expect(formatHash(" AABBCCDD ")).toBe("aabbccdd");
    expect(formatHash("0123456789abcdef")).toBe("0123456789ab…");
    expect(formatHash("0123456789abcdef", 8)).toBe("01234567…");
    expect(formatHash("not-a-hash")).toBe("—");
    expect(formatHash("abc", 0)).toBe("—");
  });

  it("preserves valid purls and shortens long values within the requested width", () => {
    const short = "pkg:npm/zod@4.3.6";
    const long = "pkg:npm/%40finite-state/security-package@12.0.0?arch=x86_64&os=linux";
    expect(formatPurl(short)).toBe(short);
    expect(formatPurl(long, 32)).toHaveLength(32);
    expect(formatPurl(long, 32)).toContain("…");
    expect(formatPurl("https://example.com/package")).toBe("—");
    expect(formatPurl("pkg:npm")).toBe("—");
    expect(formatPurl("pkg:npm/name with space")).toBe("—");
    expect(formatPurl(short, 7)).toBe("—");
  });
});

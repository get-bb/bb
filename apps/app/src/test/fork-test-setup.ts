// bb-fork(windows): test-environment adjustments for hosts whose OS defaults and
// I/O speeds differ from the en-US CI machines the suites were written on.
export {};

// Pin the default locale to en-US so assertions that hard-code English number
// and date formatting stay stable. `LANG`/`LC_ALL` do not change Node's Intl
// default on Windows, and the global Intl.NumberFormat binding does not affect
// `toLocaleString`, so both entry points are patched.
const TEST_LOCALE = "en-US";

const NativeNumberFormat = Intl.NumberFormat;
const NativeDateTimeFormat = Intl.DateTimeFormat;
const nativeNumberToLocaleString = Number.prototype.toLocaleString;
const nativeDateToLocaleString = Date.prototype.toLocaleString;
const nativeDateToLocaleDateString = Date.prototype.toLocaleDateString;
const nativeDateToLocaleTimeString = Date.prototype.toLocaleTimeString;

Intl.NumberFormat = function (
  locales?: Intl.LocalesArgument,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  return new NativeNumberFormat(locales ?? TEST_LOCALE, options);
} as unknown as typeof Intl.NumberFormat;

Intl.DateTimeFormat = function (
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new NativeDateTimeFormat(locales ?? TEST_LOCALE, options);
} as unknown as typeof Intl.DateTimeFormat;

Number.prototype.toLocaleString = function (
  locales?: Intl.LocalesArgument,
  options?: Intl.NumberFormatOptions,
): string {
  return nativeNumberToLocaleString.call(this, locales ?? TEST_LOCALE, options);
};

Date.prototype.toLocaleString = function (
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): string {
  return nativeDateToLocaleString.call(this, locales ?? TEST_LOCALE, options);
};

Date.prototype.toLocaleDateString = function (
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): string {
  return nativeDateToLocaleDateString.call(
    this,
    locales ?? TEST_LOCALE,
    options,
  );
};

Date.prototype.toLocaleTimeString = function (
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): string {
  return nativeDateToLocaleTimeString.call(
    this,
    locales ?? TEST_LOCALE,
    options,
  );
};

// Native Windows transform/import startup is slower than CI, so the 1s
// testing-library default is too tight for lazily imported code views and
// tree models.
if (typeof window !== "undefined") {
  const { configure } = await import("@testing-library/react");
  configure({ asyncUtilTimeout: 5_000 });
}

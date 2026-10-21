const COOKIE_RESTRICTED_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
  "GB",
  "CH",
]);

export function allowsAnalyticsCookie(request: Request): boolean {
  const cf: unknown = Reflect.get(request, "cf");
  const country =
    typeof cf === "object" &&
    cf !== null &&
    "country" in cf &&
    typeof cf.country === "string"
      ? cf.country.toUpperCase()
      : null;
  if (
    request.headers.get("Sec-GPC") === "1" ||
    country === null ||
    !/^[A-Z]{2}$/.test(country) ||
    country === "XX" ||
    country === "T1" ||
    COOKIE_RESTRICTED_COUNTRIES.has(country)
  ) {
    return false;
  }
  return true;
}

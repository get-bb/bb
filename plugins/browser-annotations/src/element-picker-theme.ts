export interface BrowserElementPickerTheme {
  fillColor: string;
  outlineColor: string;
}

export function readBrowserElementPickerTheme(): BrowserElementPickerTheme {
  const styles = getComputedStyle(document.documentElement);
  const outlineColor =
    styles.getPropertyValue("--ring").trim() ||
    styles.getPropertyValue("--foreground").trim() ||
    "#3b82f6";
  return {
    fillColor: `color-mix(in oklab, ${outlineColor} 14%, transparent)`,
    outlineColor,
  };
}

export const FALLBACK_BROWSER_ELEMENT_PICKER_THEME: BrowserElementPickerTheme =
  {
    fillColor: "color-mix(in oklab, #3b82f6 14%, transparent)",
    outlineColor: "#3b82f6",
  };

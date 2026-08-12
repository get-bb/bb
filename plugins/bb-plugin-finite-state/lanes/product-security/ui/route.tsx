export type ProductSecurityTab = "tara" | "requirements" | "verifications";

export interface ProductSecurityRoute {
  tab: ProductSecurityTab;
  detail: string[];
}

export const PRODUCT_SECURITY_TABS: readonly ProductSecurityTab[] = [
  "tara",
  "requirements",
  "verifications",
];

function isProductSecurityTab(value: string): value is ProductSecurityTab {
  return (
    value === "tara" || value === "requirements" || value === "verifications"
  );
}

export function parseProductSecurityRoute(
  subPath: string,
): ProductSecurityRoute {
  const segments = subPath.split("/").filter(Boolean);
  const candidate = segments[0];
  const tab = candidate && isProductSecurityTab(candidate) ? candidate : "tara";
  return { tab, detail: segments.slice(1) };
}

export function productSecuritySubPath(tab: ProductSecurityTab): string {
  return tab;
}

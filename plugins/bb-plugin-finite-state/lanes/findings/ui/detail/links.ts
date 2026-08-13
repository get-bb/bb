export interface FindingCrossLink {
  kind: "firmware" | "sbom" | "tara" | "requirement" | "verification";
  target: string;
  label: string;
  ready: boolean;
  reason?: string;
  action?: "pull" | "inspect";
}

export interface FindingNavigation {
  toPluginPanel(
    panelId: string,
    options?: { subPath?: string; replace?: boolean },
  ): void;
}

function bytesToBase64Url(value: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function navigateFindingLink(navigate: FindingNavigation, link: FindingCrossLink): void {
  if (!link.ready) return;
  if (link.kind === "sbom") {
    navigate.toPluginPanel("bom", { subPath: `software/${bytesToBase64Url(link.target)}` });
  } else if (link.kind === "firmware") {
    navigate.toPluginPanel("firmware", { subPath: `tree/${encodeURIComponent(link.target)}` });
  } else if (link.kind === "tara") {
    navigate.toPluginPanel("product-security", { subPath: `tara/nodes/${encodeURIComponent(link.target)}` });
  } else if (link.kind === "requirement") {
    navigate.toPluginPanel("product-security", { subPath: `requirements/trace/${encodeURIComponent(link.target)}` });
  } else {
    const path = link.target.split("/").map(segment => encodeURIComponent(segment)).join("/");
    navigate.toPluginPanel("product-security", { subPath: `verifications/${path}` });
  }
}

export function navigateFindingLinkRecovery(navigate: FindingNavigation, link: FindingCrossLink): void {
  if (link.kind === "sbom") navigate.toPluginPanel("bom", { subPath: "software" });
  else if (link.kind === "firmware") navigate.toPluginPanel("firmware");
  else if (link.kind === "tara") navigate.toPluginPanel("product-security", { subPath: "tara" });
  else navigate.toPluginPanel("product-security", { subPath: link.kind === "requirement" ? "requirements" : "verifications" });
}

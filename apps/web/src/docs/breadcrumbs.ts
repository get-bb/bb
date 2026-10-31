const SITE = "https://getbb.app";

export function breadcrumbJsonLd(
  breadcrumbs: readonly { name: string; url: string }[],
): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${SITE}${crumb.url}`,
    })),
  };
  return JSON.stringify(data).replace(/</gu, "\\u003c");
}

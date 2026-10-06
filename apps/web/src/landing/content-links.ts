export interface ContentLink {
  label: string;
  href: string;
}

export interface ContentLinkGroup {
  title: string;
  links: ContentLink[];
}

export const CONTENT_LINK_GROUPS: ContentLinkGroup[] = [
  {
    title: "Compare",
    links: [{ label: "bb vs Superset", href: "/compare/superset-alternative" }],
  },
];

export const CONTENT_PATHS: string[] = CONTENT_LINK_GROUPS.flatMap((group) =>
  group.links.map((link) => link.href),
);

import {
  createContext,
  isValidElement,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";

import { useCopy } from "../guides/guide-blocks";

const SITE = "https://getbb.app";
const LINK_COPIED = "Link to this section copied";

export const DocsPageUrl = createContext("/docs");

export function headingText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) return children.map(headingText).join("");
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return headingText(children.props.children);
  }
  return "";
}

function HeadingAnchor({ id }: { id: string }) {
  const pageUrl = useContext(DocsPageUrl);
  const { copy } = useCopy(`${SITE}${pageUrl}#${id}`, LINK_COPIED);
  return (
    <a
      className="docs-anchor"
      href={`#${id}`}
      aria-label="Copy link to this section"
      onClick={() => void copy()}
    >
      #
    </a>
  );
}

export function DocsH2({ id, children, ...props }: ComponentProps<"h2">) {
  return (
    <h2 id={id} {...props}>
      {children}
      {id ? <HeadingAnchor id={id} /> : null}
    </h2>
  );
}

export function DocsH3({ id, children, ...props }: ComponentProps<"h3">) {
  return (
    <h3 id={id} {...props}>
      {children}
      {id ? <HeadingAnchor id={id} /> : null}
    </h3>
  );
}

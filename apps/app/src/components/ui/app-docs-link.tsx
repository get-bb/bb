import type { ReactNode } from "react";
import { DocsLink } from "@bb/shared-ui/docs-link";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";

export function AppDocsLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <DocsLink href={href} onOpen={openUrlInExternalBrowser}>
      {children}
    </DocsLink>
  );
}

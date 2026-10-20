import { DocBody } from "./doc-body";
import { DocsLayout } from "./docs-layout";
import type { DocMeta } from "./types";

export function DocPage({ meta, body }: { meta: DocMeta; body: string }) {
  return (
    <DocsLayout currentPath={meta.path} headings={meta.headings}>
      <article>
        <header className="docs-title">
          <h1>{meta.title}</h1>
          <p>{meta.description}</p>
        </header>
        <DocBody body={body} />
      </article>
    </DocsLayout>
  );
}

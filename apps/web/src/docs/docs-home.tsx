import { DOCS, DOC_SECTIONS } from "./docs";
import { DocsLayout } from "./docs-layout";

export function DocsHome() {
  return (
    <DocsLayout currentPath="/docs">
      <header className="docs-title">
        <h1>Docs</h1>
      </header>
      {DOC_SECTIONS.map((section) => {
        const pages = DOCS.filter((doc) => doc.section === section.id);
        if (pages.length === 0) return null;
        return (
          <section className="docs-topic" key={section.id}>
            <h2>{section.title}</h2>
            <ul className="docs-article-list">
              {pages.map((doc) => (
                <li key={doc.slug}>
                  <h3>
                    <a href={doc.path}>{doc.title}</a>
                  </h3>
                  <p>{doc.description}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </DocsLayout>
  );
}

import { useStaticSearch } from "fumadocs-core/search/client";

export const DOCS_SEARCH_INDEX = "/docs/search.json";

export function DocsSearch() {
  const { search, onSearchChange, isLoading, data, error } = useStaticSearch({
    from: DOCS_SEARCH_INDEX,
  });
  const items = (data?.items ?? []).flatMap((item) =>
    item.type === "table" ? [] : [item],
  );
  return (
    <div className="docs-search" role="search">
      <input
        type="search"
        className="docs-search-input"
        placeholder="Search docs"
        aria-label="Search docs"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      {search.length > 0 ? (
        <ul className="docs-search-results" aria-busy={isLoading}>
          {error ? <li className="docs-search-empty">Search failed</li> : null}
          {!error && data && items.length === 0 ? (
            <li className="docs-search-empty">No results</li>
          ) : null}
          {items.slice(0, 8).map((item) => (
            <li key={item.id}>
              <a href={item.url} data-kind={item.type}>
                {item.content}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

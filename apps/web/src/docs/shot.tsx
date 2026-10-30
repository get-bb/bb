export const SHOT_PLACEHOLDER_PATTERN = /<Shot\b/u;

export function Shot({ todo }: { todo: string }) {
  return (
    <div
      className="docs-shot"
      role="img"
      aria-label={`Image placeholder: ${todo}`}
    >
      <strong>Image placeholder</strong>
      <span>{todo}</span>
      <small>Filled by the docs-images skill before merge</small>
    </div>
  );
}

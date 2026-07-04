// omp (oh-my-pi) brand mark: the official Π glyph (top bar + two asymmetric
// stems), monochrome via `currentColor` so it themes consistently with the
// other provider icons. Distinct from vanilla pi's "Pi" wordmark by shape.
export function OmpIcon({ className }: { className?: string }) {
  return (
    <svg
      fill="currentColor"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <title>oh-my-pi</title>
      <path d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z" />
    </svg>
  );
}

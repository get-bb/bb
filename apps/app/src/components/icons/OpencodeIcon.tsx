// opencode brand mark (opencode.ai/brand). Rendered in currentColor so it
// adapts to light/dark like the other provider glyphs; the lower-inner square
// uses reduced opacity to preserve the two-tone layered look of the mark.
// The viewBox pads the 240x300 mark into a centered square at ~80% so it sits
// at a comparable visual size to the other (square) provider icons rather than
// filling the slot edge-to-edge.
export function OpencodeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-72 -42 384 384"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <title>opencode</title>
      <path d="M180 240H60V120H180V240Z" fill="currentColor" fillOpacity={0.45} />
      <path
        d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z"
        fill="currentColor"
      />
    </svg>
  );
}

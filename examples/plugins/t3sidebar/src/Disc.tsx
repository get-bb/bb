import type { PluginSidebarThread } from "@bb/plugin-sdk/app";

/**
 * A per-thread dot. Colour comes from the thread's id so the same thread keeps
 * the same colour everywhere it appears, and every hue is a rotation of one
 * accent, so a custom palette still applies.
 *
 * `thread` is null for the "and more" disc in a cluster.
 */
export function Disc({ thread }: { thread: PluginSidebarThread | null }) {
  const hue = thread === null ? 0 : hashHue(thread.id);
  return (
    <span
      className="inline-block size-3.5 shrink-0 rounded-full border border-background"
      style={{
        backgroundColor:
          thread === null
            ? "var(--muted-foreground)"
            : `oklch(0.72 0.13 ${hue})`,
      }}
    />
  );
}

export function hashHue(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 360;
  }
  return hash;
}

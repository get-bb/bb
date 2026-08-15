import type { CSSProperties, ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { neutral } from "./showcase-tokens";

/**
 * The vocabulary every showcase scene is drawn from.
 *
 * Scenes are deliberately abstract: enough structure to read as "a board" or "a
 * checklist" at a glance, with only the few words that carry meaning. Keeping
 * the primitives here means the Plugins and Skills windows share one visual
 * grammar — same bar weights, same card insets — so the two heroes read as
 * siblings rather than two people's idea of a mock UI.
 */

/** A skeleton text line. Width is a percentage so scenes scale fluidly. */
export function Bar({
  width,
  strength = 12,
  className,
}: {
  width: string;
  strength?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("h-1.5 rounded-full", className)}
      style={{ width, background: neutral(strength) }}
    />
  );
}

/** A surface inside the mini window: a card, row, or panel. */
export function SceneCard({
  children,
  className,
  style,
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn("rounded-md border p-1.5", className)}
      style={{
        background: "var(--canvas)",
        borderColor: neutral(11),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A small section label inside a scene. */
export function SceneLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-2xs font-medium" style={{ color: neutral(52) }}>
      {children}
    </span>
  );
}

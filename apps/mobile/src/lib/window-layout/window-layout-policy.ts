import {
  shellWindowLayoutSchema,
  type ShellWindowLayout,
} from "@bb/mobile-bridge";

export function parseNativeWindowLayout(
  payload: unknown,
): ShellWindowLayout | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { verticalBarEdge, verticalBarBehavior, occlusions } = payload as {
    verticalBarEdge?: unknown;
    verticalBarBehavior?: unknown;
    occlusions?: unknown;
  };
  const parsed = shellWindowLayoutSchema.safeParse({
    verticalBar: { edge: verticalBarEdge, behavior: verticalBarBehavior },
    occlusions,
  });
  return parsed.success ? parsed.data : null;
}

export function windowLayoutKey(layout: ShellWindowLayout | null): string {
  return layout === null ? "" : JSON.stringify(layout);
}

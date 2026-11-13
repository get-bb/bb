import {
  shellWindowLayoutSchema,
  type ShellWindowLayout,
} from "@bb/mobile-bridge";

export function parseNativeWindowLayout(
  payload: unknown,
): ShellWindowLayout | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { verticalBarEdge, verticalBarBehavior, occlusions, topBar } =
    payload as {
      verticalBarEdge?: unknown;
      verticalBarBehavior?: unknown;
      occlusions?: unknown;
      topBar?: unknown;
    };
  const parsed = shellWindowLayoutSchema.safeParse({
    verticalBar: { edge: verticalBarEdge, behavior: verticalBarBehavior },
    occlusions,
    ...(topBar === undefined ? {} : { topBar }),
  });
  return parsed.success ? parsed.data : null;
}

export function windowLayoutKey(layout: ShellWindowLayout | null): string {
  return layout === null ? "" : JSON.stringify(layout);
}

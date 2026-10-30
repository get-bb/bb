export type WorkSource = "first_run" | "replay" | "other";

let pendingSource: WorkSource = "other";

export function recordOnboardingWorkSource(
  source: "first_run" | "replay",
): void {
  pendingSource = source;
}

export function takeOnboardingWorkSource(): WorkSource {
  const source = pendingSource;
  pendingSource = "other";
  return source;
}

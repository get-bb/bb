import { z } from "zod";
import type { OnboardingStepId, StepOutcome } from "./onboarding-model";

const ONBOARDING_PROGRESS_STORAGE_KEY = "bb.onboarding.progress";

const stepIdSchema = z.enum(["agent", "projects", "plugins", "devices"]);

const storedProgressSchema = z.object({
  dataDir: z.string(),
  step: stepIdSchema,
  outcomes: z.array(z.tuple([stepIdSchema, z.enum(["completed", "skipped"])])),
  reachedSteps: z.array(stepIdSchema),
  exposed: z.boolean(),
  started: z.boolean(),
  projectIdsAtOpen: z.array(z.string()).nullable(),
});

export interface OnboardingProgress {
  step: OnboardingStepId;
  outcomes: ReadonlyMap<OnboardingStepId, StepOutcome>;
  reachedSteps: ReadonlySet<OnboardingStepId>;
  exposed: boolean;
  started: boolean;
  projectIdsAtOpen: ReadonlySet<string> | null;
}

export function freshOnboardingProgress(
  step: OnboardingStepId = "agent",
): OnboardingProgress {
  return {
    step,
    outcomes: new Map(),
    reachedSteps: new Set(),
    exposed: false,
    started: false,
    projectIdsAtOpen: null,
  };
}

export function readOnboardingProgress(dataDir: string): OnboardingProgress {
  try {
    const raw = window.localStorage.getItem(ONBOARDING_PROGRESS_STORAGE_KEY);
    if (raw === null) return freshOnboardingProgress();
    const stored = storedProgressSchema.safeParse(JSON.parse(raw));
    if (!stored.success || stored.data.dataDir !== dataDir) {
      return freshOnboardingProgress();
    }
    return {
      step: stored.data.step,
      outcomes: new Map(stored.data.outcomes),
      reachedSteps: new Set(stored.data.reachedSteps),
      exposed: stored.data.exposed,
      started: stored.data.started,
      projectIdsAtOpen:
        stored.data.projectIdsAtOpen === null
          ? null
          : new Set(stored.data.projectIdsAtOpen),
    };
  } catch {
    return freshOnboardingProgress();
  }
}

export function saveOnboardingProgress(
  dataDir: string,
  progress: OnboardingProgress,
): void {
  const stored: z.infer<typeof storedProgressSchema> = {
    dataDir,
    step: progress.step,
    outcomes: [...progress.outcomes],
    reachedSteps: [...progress.reachedSteps],
    exposed: progress.exposed,
    started: progress.started,
    projectIdsAtOpen:
      progress.projectIdsAtOpen === null
        ? null
        : [...progress.projectIdsAtOpen],
  };
  try {
    window.localStorage.setItem(
      ONBOARDING_PROGRESS_STORAGE_KEY,
      JSON.stringify(stored),
    );
  } catch {
    return;
  }
}

export function clearOnboardingProgress(): void {
  try {
    window.localStorage.removeItem(ONBOARDING_PROGRESS_STORAGE_KEY);
  } catch {
    return;
  }
}

import { atom } from "jotai";
import type { OnboardingStepId } from "./onboarding-model";

export const onboardingReopenStepAtom = atom<OnboardingStepId | null>(null);

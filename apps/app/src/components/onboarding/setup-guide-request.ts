import { atom, useAtom, useSetAtom } from "jotai";
import type { OnboardingStepId } from "./onboarding-model";

const setupGuideRequestAtom = atom<OnboardingStepId | null>(null);

export function useSetupGuideRequest() {
  return useAtom(setupGuideRequestAtom);
}

export function useOpenSetupGuide() {
  return useSetAtom(setupGuideRequestAtom);
}

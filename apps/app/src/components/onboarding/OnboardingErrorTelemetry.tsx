import {
  Component,
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import type { OnboardingStepId } from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

type OnboardingErrorKind = "render" | "uncaught" | "unhandled_rejection";

const MAX_ERROR_REPORTS_PER_GUIDE = 5;

const OnboardingErrorStepContext = createContext<
  ((step: OnboardingStepId) => void) | null
>(null);

export function useOnboardingErrorStep(step: OnboardingStepId): void {
  const setStep = useContext(OnboardingErrorStepContext);
  useEffect(() => {
    setStep?.(step);
  }, [setStep, step]);
}

interface OnboardingErrorTelemetryProps {
  entry: OnboardingEntry;
  initialStep: OnboardingStepId;
  closing: boolean;
  children: ReactNode;
}

interface OnboardingErrorTelemetryState {
  crashed: boolean;
  error: unknown;
}

export class OnboardingErrorTelemetry extends Component<
  OnboardingErrorTelemetryProps,
  OnboardingErrorTelemetryState
> {
  override state: OnboardingErrorTelemetryState = {
    crashed: false,
    error: null,
  };

  private step: OnboardingStepId = this.props.initialStep;

  private readonly reported = new Set<string>();

  private readonly setStep = (step: OnboardingStepId): void => {
    this.step = step;
  };

  private readonly onUncaughtError = (): void =>
    this.reportWindowError("uncaught");

  private readonly onUnhandledRejection = (): void =>
    this.reportWindowError("unhandled_rejection");

  static getDerivedStateFromError(
    error: unknown,
  ): OnboardingErrorTelemetryState {
    return { crashed: true, error };
  }

  override componentDidMount(): void {
    window.addEventListener("error", this.onUncaughtError);
    window.addEventListener("unhandledrejection", this.onUnhandledRejection);
  }

  override componentWillUnmount(): void {
    window.removeEventListener("error", this.onUncaughtError);
    window.removeEventListener("unhandledrejection", this.onUnhandledRejection);
  }

  private reportWindowError(
    kind: Exclude<OnboardingErrorKind, "render">,
  ): void {
    if (this.props.closing) return;
    this.report(kind);
  }

  private report(kind: OnboardingErrorKind): void {
    const key = `${kind}:${this.step}`;
    if (
      this.reported.has(key) ||
      this.reported.size >= MAX_ERROR_REPORTS_PER_GUIDE
    ) {
      return;
    }
    this.reported.add(key);
    recordTelemetryEvent({
      name: "onboarding_error",
      properties: { step: this.step, entry: this.props.entry, kind },
    });
  }

  override render(): ReactNode {
    if (this.state.crashed) {
      this.report("render");
      throw this.state.error;
    }
    return (
      <OnboardingErrorStepContext.Provider value={this.setStep}>
        {this.props.children}
      </OnboardingErrorStepContext.Provider>
    );
  }
}

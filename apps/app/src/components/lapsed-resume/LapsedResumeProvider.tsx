import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SystemLapsedResumeResponse } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { APP_ROOT_ROUTE_PATH, getThreadRoutePath } from "@/lib/route-paths";
import {
  recordLapsedResumeDismissed,
  recordLapsedResumeShown,
} from "./lapsed-resume-telemetry";

interface LapsedResumeState {
  threads: SystemLapsedResumeResponse["threads"];
  dismiss: () => void;
}

const LapsedResumeContext = createContext<LapsedResumeState | null>(null);

export function useLapsedResume(): LapsedResumeState | null {
  return useContext(LapsedResumeContext);
}

export function LapsedResumeProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const initialLocation = useRef(location);
  const currentLocation = useRef(location);
  const navigateRef = useRef(navigate);
  const interacted = useRef(false);
  const navigated = useRef(false);
  const request = useRef<Promise<SystemLapsedResumeResponse> | null>(null);
  const handled = useRef(false);
  const dismissed = useRef(false);
  const pendingExposure = useRef<{ path: string; id: string } | null>(null);
  const [resume, setResume] = useState<SystemLapsedResumeResponse | null>(null);

  useLayoutEffect(() => {
    if (location.key !== initialLocation.current.key) navigated.current = true;
    currentLocation.current = location;
    navigateRef.current = navigate;
  }, [location, navigate]);

  useEffect(() => {
    const markInteraction = () => {
      interacted.current = true;
    };
    document.addEventListener("pointerdown", markInteraction, true);
    document.addEventListener("keydown", markInteraction, true);
    return () => {
      document.removeEventListener("pointerdown", markInteraction, true);
      document.removeEventListener("keydown", markInteraction, true);
    };
  }, []);

  useEffect(() => {
    let active = true;
    request.current ??= sdk.system.experimental_openLapsedResume();
    void request.current.then(
      (result) => {
        if (!active || handled.current) return;
        handled.current = true;
        if (!result.lapsed) return;
        setResume(result);
        const initial = initialLocation.current;
        if (
          result.target === null ||
          interacted.current ||
          navigated.current ||
          currentLocation.current.key !== initial.key ||
          currentLocation.current.pathname !== initial.pathname ||
          initial.pathname !== APP_ROOT_ROUTE_PATH ||
          initial.search !== "" ||
          initial.hash !== ""
        ) {
          return;
        }
        const path = getThreadRoutePath(result.target);
        if (result.suggestionAnalyticsId !== null) {
          pendingExposure.current = { path, id: result.suggestionAnalyticsId };
        }
        void navigateRef.current(path, { replace: true });
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const exposure = pendingExposure.current;
    if (exposure === null || location.key === initialLocation.current.key) {
      return;
    }
    pendingExposure.current = null;
    if (location.pathname === exposure.path) {
      recordLapsedResumeShown(exposure.id);
    }
  }, [location]);

  const dismiss = useCallback(() => {
    if (dismissed.current || resume === null) return;
    dismissed.current = true;
    setResume(null);
    if (resume.suggestionAnalyticsId !== null) {
      recordLapsedResumeDismissed(resume.suggestionAnalyticsId);
    }
  }, [resume]);

  const value = useMemo(
    () => (resume === null ? null : { threads: resume.threads, dismiss }),
    [resume, dismiss],
  );

  return (
    <LapsedResumeContext.Provider value={value}>
      {children}
    </LapsedResumeContext.Provider>
  );
}

import { useRouteContext } from "@tanstack/react-router";
import { useEffect } from "react";

import { exposeExperiment } from "../landing/analytics";
import {
  NO_EXPERIMENTS,
  experimentVariant,
  type ExperimentBootstrap,
  type ExperimentDevices,
  type ExperimentKey,
  type ExperimentVariant,
} from "./flags";

export function experimentsBeforeLoad({
  serverContext,
}: {
  serverContext?: { experiments: ExperimentBootstrap };
}): { experiments: ExperimentBootstrap } | undefined {
  return serverContext === undefined
    ? undefined
    : { experiments: serverContext.experiments };
}

export function useExperimentBootstrap(): ExperimentBootstrap {
  return useRouteContext({
    from: "__root__",
    select: (context) => context?.experiments ?? NO_EXPERIMENTS,
  });
}

export function useExperiment<K extends ExperimentKey>(
  key: K,
): ExperimentVariant<K> {
  return experimentVariant(useExperimentBootstrap(), key);
}

export function useExperimentExposure(
  key: ExperimentKey,
  devices: ExperimentDevices,
  seen = true,
): void {
  const bootstrap = useExperimentBootstrap();
  const assigned =
    !bootstrap.preview && bootstrap.featureFlags[key] !== undefined;
  useEffect(() => {
    if (assigned && seen) {
      exposeExperiment(key, devices);
    }
  }, [assigned, seen, key, devices]);
}

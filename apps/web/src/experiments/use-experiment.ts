import { useCallback, useEffect } from "react";

import { exposeExperiment } from "../landing/analytics";
import { useExperimentBootstrap } from "./context";
import {
  experimentVariant,
  isKnownVariant,
  type ExperimentBootstrap,
  type ExperimentDevices,
  type ExperimentKey,
  type ExperimentVariant,
} from "./flags";

export { RouteExperimentsProvider } from "./context";

export function experimentsBeforeLoad({
  serverContext,
}: {
  serverContext?: { experiments: ExperimentBootstrap };
}): { experiments: ExperimentBootstrap } | undefined {
  return serverContext === undefined
    ? undefined
    : { experiments: serverContext.experiments };
}

export function useExperiment<K extends ExperimentKey>(
  key: K,
): ExperimentVariant<K> {
  return experimentVariant(useExperimentBootstrap(), key);
}

export function useExperimentExposer(
  key: ExperimentKey,
  devices: ExperimentDevices,
): () => void {
  const bootstrap = useExperimentBootstrap();
  const rendered = bootstrap.featureFlags[key];
  const assigned =
    !bootstrap.preview && isKnownVariant(key, rendered) ? rendered : null;
  return useCallback(() => {
    if (assigned) {
      exposeExperiment(key, assigned, devices);
    }
  }, [assigned, key, devices]);
}

export function useExperimentExposure(
  key: ExperimentKey,
  devices: ExperimentDevices,
  seen = true,
): void {
  const expose = useExperimentExposer(key, devices);
  useEffect(() => {
    if (seen) expose();
  }, [expose, seen]);
}

import { useCallback, useEffect } from "react";

import { exposeExperiment } from "../landing/analytics";
import { useExperimentBootstrap } from "./context";
import {
  experimentVariant,
  type ExperimentBootstrap,
  type ExperimentDevices,
  type ExperimentKey,
  type ExperimentVariant,
} from "./flags";

export {
  ExperimentsProvider,
  RouteExperimentsProvider,
  useExperimentBootstrap,
} from "./context";

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
  const assigned =
    !bootstrap.preview && bootstrap.featureFlags[key] !== undefined;
  return useCallback(() => {
    if (assigned) {
      exposeExperiment(key, devices);
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

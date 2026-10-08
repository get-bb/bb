export interface EnvironmentRemoval {
  environmentId: string;
  removedAt: number;
  hostId: string | null;
  path: string | null;
  providerOwnedPath: boolean;
}

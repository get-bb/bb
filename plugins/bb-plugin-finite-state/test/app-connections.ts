export function connectedRemoteStatus() {
  return {
    platform: { state: "connected" as const, message: null, checkedAt: null },
    assuranceStudio: {
      state: "disabled" as const,
      message: "Assurance Studio is not configured",
      checkedAt: null,
    },
    forgeCompute: {
      state: "disabled" as const,
      message: "Forge Compute is disabled",
      checkedAt: null,
    },
  };
}

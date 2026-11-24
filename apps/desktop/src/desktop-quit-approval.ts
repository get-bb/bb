interface CloseCandidate {
  isDestroyed(): boolean;
}

export function createDesktopQuitApproval() {
  let approvedWindow: CloseCandidate | null = null;
  return {
    approve(window: CloseCandidate): void {
      approvedWindow = window;
    },
    clear(): void {
      approvedWindow = null;
    },
    hasClosedApprovedWindow(): boolean {
      return approvedWindow?.isDestroyed() === true;
    },
  };
}

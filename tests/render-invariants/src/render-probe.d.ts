interface RenderProbe {
  reset(): void;
  quietFor(): number;
  renderCount(): number;
  report(containerSelector: string | null, since: number): unknown;
}

declare global {
  interface Window {
    __renderProbe: RenderProbe;
  }
}

export {};

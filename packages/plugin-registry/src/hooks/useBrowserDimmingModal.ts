/**
 * Plugin flavor of the app's `hooks/useBrowserDimmingModal.ts` (registry
 * override): a no-op. In the host app this hook hides the native in-app
 * browser WebContentsView while a modal is open (a DOM backdrop cannot dim
 * an OS-level overlay); that coordination lives in host state a plugin
 * bundle deliberately does not share. Plugin dialogs simply skip it — the
 * host dims the browser for its own modals only.
 */
export function useBrowserDimmingModal(_active: boolean): void {}

/** Host flavor reports live modal state; plugins have none. */
export function useIsBrowserDimmingModalOpen(): boolean {
  return false;
}

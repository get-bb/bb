/**
 * Plugin/registry flavor of the app's `hooks/useBrowserDimmingModal.ts`: a
 * no-op. In the host app this hook hides the native in-app browser
 * `WebContentsView` while a modal is open (a DOM backdrop cannot dim an
 * OS-level overlay); that coordination lives in host state a plugin bundle
 * deliberately does not share. The app injects its real jotai-backed flavor
 * over this file at build time (see apps/app/vite.config.ts's shared-ui env
 * seam); plugins and the vendored registry keep this no-op so `dialog.tsx`
 * stays byte-identical across every consumer without stripping the call.
 */
export function useBrowserDimmingModal(_active: boolean): void {}

/** Host flavor reports live modal state; plugins have none. */
export function useIsBrowserDimmingModalOpen(): boolean {
  return false;
}

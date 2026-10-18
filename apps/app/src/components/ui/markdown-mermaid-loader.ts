type PeleModule = typeof import("pele/lazy");

let peleImportPromise: Promise<PeleModule> | null = null;

export function loadPele(): Promise<PeleModule> {
  if (peleImportPromise === null) {
    peleImportPromise = import("pele/lazy");
  }

  return peleImportPromise;
}

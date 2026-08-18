// Portable type declarations for `@get-bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/get-bb/bb

declare function isComposerDraftEmpty(text: string, attachmentCount: number): boolean;

export { isComposerDraftEmpty };

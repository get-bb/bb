/* The pre-paint half of the bb.theme model. This file is imported with Vite's
   `?raw` so its exact bytes become the inline <head> script in __root.tsx —
   never transformed, so the server and the client build the same string and
   hydration has nothing to disagree about. (Deriving the script from a
   compiled function's toString() does not hold: esbuild's SSR and client
   transforms re-print it with different stray semicolons.)

   Two rules follow from being inlined as text: it may only touch its
   parameters and browser globals, since a module-scope reference would be
   renamed and throw here; and it stays plain ES5-shaped JavaScript, because
   nothing compiles it. lib/theme.ts owns the constants passed in and the
   matching runtime helpers. */
function themeInit(storageKey, darkQuery, themeColorSelector) {
  var preference = "system";
  // Reading storage is the only step that can throw (Safari's "block all
  // cookies", sandboxed frames). It gets its own try so a throw still leaves
  // the OS scheme honoured instead of aborting the rest of the script.
  try {
    var stored = localStorage.getItem(storageKey);
    if (stored === "dark" || stored === "light") preference = stored;
  } catch (error) {
    // Storage is unavailable; stay on "system".
  }

  var root = document.documentElement;
  // The nav button's glyph keys off the preference, not the resolved theme.
  root.setAttribute("data-theme-preference", preference);
  if (
    preference === "dark" ||
    (preference === "system" && matchMedia(darkQuery).matches)
  ) {
    root.classList.add("dark");
  }

  // <head> ships one theme-color meta per scheme, so "system" already resolves
  // with no JS at all. An explicit preference overrides the OS by narrowing
  // which meta the browser may match — never by editing content: React
  // hydrates a hoistable <meta> by matching its content attribute, so a
  // content edit here orphans the server's meta and appends a duplicate.
  // `media` is not part of that match.
  if (preference === "system") return;
  var narrow = function () {
    var metas = document.querySelectorAll(themeColorSelector);
    for (var i = 0; i < metas.length; i++) {
      metas[i].setAttribute(
        "media",
        metas[i].getAttribute("data-scheme") === preference ? "all" : "not all",
      );
    }
  };
  // The metas are parsed after this script, so on a cold parse this waits for
  // the document; on a warm one it applies straight away.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", narrow);
  } else {
    narrow();
  }
}

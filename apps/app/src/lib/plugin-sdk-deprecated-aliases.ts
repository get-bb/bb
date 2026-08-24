/**
 * One-release deprecated aliases for the `@get-bb/plugin-sdk/app` members that
 * stabilization renamed: `experimental_UrlLink` → `UrlLink`,
 * `BbNavigate.experimental_openUrl` → `openUrl`, and the `experimental_Original`
 * → `Original` delegation prop on the thread-list, file-opener, source-code
 * and diff replacement props.
 *
 * Why the app carries them: `bb plugin build` shims the SDK specifier to
 * `globalThis.__bbPluginRuntime.pluginSdkApp` with
 * `export const { ...names } = runtime.pluginSdkApp`, where `names` is the
 * facade export list of the SDK that built the bundle. A bundle built against
 * an SDK published before 0.4.16 destructures the old names when it loads; a
 * missing member arrives as `undefined`, and React then fails with an opaque
 * "Element type is invalid". The alias keeps such bundles working and names
 * the rename once in the console.
 *
 * Removal target: bb 0.42 (the aliases ship in 0.40 and 0.41). Delete this
 * module, its two runtime call sites, the `experimental_Original={...}` prop at
 * the four replacement hosts, and the `experimental_Original?` field on the
 * four SDK props interfaces then.
 */
import { createElement, type ComponentType } from "react";

const warnedNames = new Set<string>();

function warnDeprecatedMember(oldName: string, newName: string): void {
  if (warnedNames.has(oldName)) return;
  warnedNames.add(oldName);
  console.warn(`${oldName} is deprecated; use ${newName}. Removed in bb 0.42`);
}

const componentAliases = new Map<string, ComponentType<never>>();

/**
 * Define each `oldName` on `target` as a getter for a component alias of
 * `target[newName]`. The shim destructures every facade name when a bundle
 * loads, whether or not the bundle uses it, so the getter itself stays
 * silent; the alias is a wrapper component, created once per name so its
 * identity is stable, whose first render warns and which then renders the
 * stable member. A bundle that only destructures the old name never warns;
 * one that renders it warns once. Non-enumerable, so the alias never leaks
 * into key listings or spreads.
 */
export function installDeprecatedAliases<T extends object>(
  target: T,
  aliases: Readonly<Record<string, keyof T & string>>,
): T {
  for (const [oldName, newName] of Object.entries(aliases)) {
    Object.defineProperty(target, oldName, {
      configurable: true,
      enumerable: false,
      get() {
        const existing = componentAliases.get(oldName);
        if (existing !== undefined) return existing;
        const Member = target[newName] as ComponentType<never>;
        function DeprecatedMember(props: Record<string, unknown>) {
          warnDeprecatedMember(oldName, newName);
          return createElement(Member, props as never);
        }
        componentAliases.set(oldName, DeprecatedMember);
        return DeprecatedMember;
      },
    });
  }
  return target;
}

/** Wrap a function member so the first call through the old name warns once. */
export function deprecatedAlias<Args extends unknown[], Result>(
  oldName: string,
  newName: string,
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  return (...args) => {
    warnDeprecatedMember(oldName, newName);
    return fn(...args);
  };
}

const originalAliases = new WeakMap<ComponentType, ComponentType>();

/**
 * The `experimental_Original` value a replacement host passes beside
 * `Original`. Unlike the runtime members, a prop is read only when the plugin
 * renders it, so the alias is a wrapper whose render warns once and then
 * renders `Original`; a plugin that reads `Original` never triggers it.
 * Memoised per bound `Original` so the wrapper's identity is stable across
 * renders and React does not remount the delegated subtree.
 */
export function deprecatedOriginalAlias(
  Original: ComponentType,
): ComponentType {
  const existing = originalAliases.get(Original);
  if (existing !== undefined) return existing;
  function ExperimentalOriginal() {
    warnDeprecatedMember("experimental_Original", "Original");
    return createElement(Original);
  }
  originalAliases.set(Original, ExperimentalOriginal);
  return ExperimentalOriginal;
}

/** Test-only: forget which names have warned. */
export function resetDeprecatedAliasWarningsForTests(): void {
  warnedNames.clear();
}

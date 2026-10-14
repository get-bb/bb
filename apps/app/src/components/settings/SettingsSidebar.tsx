import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import {
  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
  COARSE_POINTER_TEXT_BASE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
} from "@bb/shared-ui/sidebar-row-classes";
import { AppCommandShortcutPill } from "@/components/commands/AppCommandShortcutHint";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  SectionSidebar,
  SectionSidebarIcon,
  SectionSidebarLabel,
  SectionSidebarActionRow,
  SectionSidebarRow,
} from "@/components/sidebar/SectionSidebar";
import { useSidebarHeaderControlAxisClass } from "@/components/sidebar/SidebarChrome";
import { useCloseMobileSidebar, useSidebar } from "@/components/ui/sidebar.js";
import { isEditableKeyboardTarget } from "@/lib/app-keybindings";
import { MACOS_APP_REGION_NO_DRAG_CLASS } from "@/lib/bb-desktop";
import { canOpenNativeScreen, shellOpenNative } from "@/lib/native-shell";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";
import { useSettingsNavState } from "./settings-nav";
import type { SettingsNavState } from "./settings-nav";
import {
  buildSettingsSearchItems,
  searchSettings,
  SETTINGS_SEARCH_ANCHOR_STATE_KEY,
  type PluginSettingSearchEntry,
  type SettingsSearchCondition,
  type SettingsSearchItem,
} from "./settings-search";
import { getSettingsSectionRoutePath } from "./settings-sections";
import { usePluginSettingSearch } from "./usePluginSettingSearch";
import { useSettingsSearchConditions } from "./useSettingsSearchConditions";

interface SettingsSidebarProps {
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
}

type SettingsSidebarNavigation = Pick<
  SettingsNavState,
  "activePluginId" | "activeSection" | "pluginEntries" | "sections"
>;

export interface SettingsSidebarPluginSettingSearch {
  entries: readonly PluginSettingSearchEntry[];
  isLoading: boolean;
  onActivate: () => void;
}

interface SettingsSidebarContentProps extends SettingsSidebarProps {
  navigation: SettingsSidebarNavigation;
  pluginSettingSearch: SettingsSidebarPluginSettingSearch;
  searchConditions: ReadonlySet<SettingsSearchCondition>;
  testIdPrefix?: string;
}

const SETTINGS_SEARCH_SHORTCUT = { label: "/" };
const SETTINGS_SEARCH_SHORTCUT_BLOCKING_SELECTOR =
  '[role="dialog"], [role="menu"], [role="listbox"]';

function useFocusSettingsSearchShortcut(
  inputRef: RefObject<HTMLInputElement | null>,
): void {
  const { isCompactViewport, open, setOpen } = useSidebar();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        isCompactViewport ||
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableKeyboardTarget(event.target) ||
        (event.target instanceof HTMLElement &&
          event.target.closest(SETTINGS_SEARCH_SHORTCUT_BLOCKING_SELECTOR) !==
            null)
      ) {
        return;
      }
      event.preventDefault();
      if (open) {
        inputRef.current?.focus();
        return;
      }
      setOpen(true);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inputRef, isCompactViewport, open, setOpen]);
}

interface SettingsSearchFieldProps {
  activeOptionId: string | undefined;
  inputRef: RefObject<HTMLInputElement | null>;
  listboxId: string | undefined;
  onClear: () => void;
  onFocus: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onQueryChange: (query: string) => void;
  query: string;
}

function SettingsSearchField({
  activeOptionId,
  inputRef,
  listboxId,
  onClear,
  onFocus,
  onKeyDown,
  onQueryChange,
  query,
}: SettingsSearchFieldProps) {
  const axisClass = useSidebarHeaderControlAxisClass();

  return (
    <label
      className={cn(
        SIDEBAR_ROW_BASE_CLASS,
        SIDEBAR_STANDARD_ROW_PADDING_CLASS,
        COARSE_POINTER_ROW_HEIGHT_CLASS,
        MACOS_APP_REGION_NO_DRAG_CLASS,
        "min-w-0 flex-1 cursor-text pr-1 text-muted-foreground hover:bg-sidebar-accent focus-within:bg-sidebar-accent",
        axisClass,
      )}
    >
      <Icon
        name="Search"
        aria-hidden
        className={cn("shrink-0", COARSE_POINTER_ICON_SIZE_CLASS)}
      />
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder="Search"
        aria-label="Search settings"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listboxId !== undefined}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        className={cn(
          COARSE_POINTER_TEXT_BASE_CLASS,
          "min-w-0 flex-1 bg-transparent text-sidebar-foreground outline-none placeholder:text-muted-foreground",
        )}
      />
      {query.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
            "h-6 w-6 shrink-0 text-muted-foreground hover:text-sidebar-foreground",
          )}
          aria-label="Clear settings search"
          onClick={onClear}
        >
          <Icon name="X" aria-hidden />
        </Button>
      ) : (
        <AppCommandShortcutPill
          shortcut={SETTINGS_SEARCH_SHORTCUT}
          className="mr-1 max-md:pointer-coarse:hidden"
        />
      )}
    </label>
  );
}

function SettingsSearchResultIcon({ item }: { item: SettingsSearchItem }) {
  return item.icon.kind === "section" ? (
    <SectionSidebarIcon name={item.icon.name} />
  ) : (
    <PluginIcon
      pluginId={item.icon.pluginId}
      icon={item.icon.icon}
      className="size-4 shrink-0"
    />
  );
}

interface SettingsSearchResultsProps {
  activeIndex: number;
  isLoading: boolean;
  listboxId: string;
  onActiveIndexChange: (index: number) => void;
  onOpen: (item: SettingsSearchItem) => void;
  results: readonly SettingsSearchItem[];
}

function settingsSearchOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

function SettingsSearchResults({
  activeIndex,
  isLoading,
  listboxId,
  onActiveIndexChange,
  onOpen,
  results,
}: SettingsSearchResultsProps) {
  if (results.length === 0) {
    if (isLoading) return null;
    return (
      <p
        role="status"
        className="px-2 py-6 text-center text-xs text-subtle-foreground"
      >
        No settings found
      </p>
    );
  }

  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label="Settings search results"
      className="mt-1 space-y-0.5"
    >
      {results.map((item, index) => (
        <Button
          key={item.id}
          id={settingsSearchOptionId(listboxId, index)}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          tabIndex={-1}
          size="sm"
          variant="ghost"
          className={cn(
            SIDEBAR_ROW_BASE_CLASS,
            SIDEBAR_STANDARD_ROW_PADDING_CLASS,
            SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
            "h-auto min-w-0 items-start justify-start overflow-hidden py-1.5 font-normal max-md:pointer-coarse:[&_[data-icon-root]]:size-5",
            index === activeIndex &&
              "bg-sidebar-accent text-sidebar-foreground",
          )}
          onPointerMove={() => onActiveIndexChange(index)}
          onClick={() => onOpen(item)}
        >
          <span className="flex h-5 shrink-0 items-center">
            <SettingsSearchResultIcon item={item} />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate leading-5">{item.title}</span>
            {item.context === null ? null : (
              <span className="block truncate text-xs text-subtle-foreground">
                {item.context}
              </span>
            )}
          </span>
        </Button>
      ))}
    </div>
  );
}

export function SettingsSidebarContent({
  onResizeMouseDown,
  isResizing,
  navigation,
  pluginSettingSearch,
  searchConditions,
  testIdPrefix = "settings",
}: SettingsSidebarContentProps) {
  const { activePluginId, activeSection, pluginEntries, sections } = navigation;
  const hasPlugins = pluginEntries.length > 0;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const closeOnMobile = useCloseMobileSidebar();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchListboxId = useId();
  const [query, setQuery] = useState("");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const searchItems = useMemo(
    () =>
      buildSettingsSearchItems({
        conditions: searchConditions,
        pluginEntries,
        pluginSettings: pluginSettingSearch.entries,
        sections,
      }),
    [pluginEntries, pluginSettingSearch.entries, searchConditions, sections],
  );
  const results = useMemo(
    () => searchSettings(query, searchItems),
    [query, searchItems],
  );
  const isSearching = query.trim().length > 0;
  const activeIndex = Math.min(activeResultIndex, results.length - 1);
  useFocusSettingsSearchShortcut(searchInputRef);

  const changeQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    setActiveResultIndex(0);
  };

  const openResult = (item: SettingsSearchItem) => {
    changeQuery("");
    closeOnMobile();
    void navigate(item.to, {
      replace: pathname === item.to,
      state:
        item.anchor === null
          ? null
          : { [SETTINGS_SEARCH_ANCHOR_STATE_KEY]: item.anchor },
    });
  };

  const moveActiveResult = (offset: -1 | 1) => {
    const nextIndex = (activeIndex + offset + results.length) % results.length;
    setActiveResultIndex(nextIndex);
    document
      .getElementById(settingsSearchOptionId(searchListboxId, nextIndex))
      ?.scrollIntoView({ block: "nearest" });
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      if (query.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      changeQuery("");
      return;
    }
    const activeResult = results[activeIndex];
    if (activeResult === undefined) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveResult(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveResult(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openResult(activeResult);
    }
  };

  return (
    <SectionSidebar
      isResizing={isResizing}
      onResizeMouseDown={onResizeMouseDown}
      testIdPrefix={testIdPrefix}
      headerSlot={
        <SettingsSearchField
          inputRef={searchInputRef}
          query={query}
          onQueryChange={changeQuery}
          onFocus={pluginSettingSearch.onActivate}
          onKeyDown={handleSearchKeyDown}
          onClear={() => {
            changeQuery("");
            searchInputRef.current?.focus();
          }}
          listboxId={
            isSearching && results.length > 0 ? searchListboxId : undefined
          }
          activeOptionId={
            isSearching && results.length > 0
              ? settingsSearchOptionId(searchListboxId, activeIndex)
              : undefined
          }
        />
      }
    >
      {isSearching ? (
        <SettingsSearchResults
          activeIndex={activeIndex}
          isLoading={pluginSettingSearch.isLoading}
          listboxId={searchListboxId}
          onActiveIndexChange={setActiveResultIndex}
          onOpen={openResult}
          results={results}
        />
      ) : (
        <>
          <div className="mt-1 space-y-0.5">
            {sections
              .filter((section) => section.id !== "archived")
              .map((section) => (
                <SectionSidebarRow
                  key={section.id}
                  active={activeSection === section.id}
                  label={section.label}
                  to={getSettingsSectionRoutePath(section.id)}
                >
                  <SectionSidebarIcon name={section.icon} />
                </SectionSidebarRow>
              ))}
          </div>
          {hasPlugins ? (
            <>
              <div className="mt-4">
                <SectionSidebarLabel>Plugins</SectionSidebarLabel>
              </div>
              <div className="mt-1 space-y-0.5">
                {pluginEntries.map((entry) => (
                  <SectionSidebarRow
                    key={entry.id}
                    active={activePluginId === entry.id}
                    label={entry.label}
                    to={getPluginConfigurationRoutePath({ pluginId: entry.id })}
                  >
                    <PluginIcon
                      pluginId={entry.id}
                      icon={entry.icon}
                      className="size-4 shrink-0"
                    />
                  </SectionSidebarRow>
                ))}
              </div>
            </>
          ) : null}
          {canOpenNativeScreen() ? (
            <>
              <div className="mt-4">
                <SectionSidebarLabel>This phone</SectionSidebarLabel>
              </div>
              <div className="mt-1 space-y-0.5">
                <SectionSidebarActionRow
                  label="This device"
                  testId="settings-nav-native-device"
                  onClick={() => shellOpenNative("device-settings")}
                >
                  <SectionSidebarIcon name="Smartphone" />
                </SectionSidebarActionRow>
              </div>
            </>
          ) : null}
          {sections.some((section) => section.id === "archived") ? (
            <>
              <div className="mt-4">
                <SectionSidebarLabel>Archived</SectionSidebarLabel>
              </div>
              <div className="mt-1 space-y-0.5">
                {sections
                  .filter((section) => section.id === "archived")
                  .map((section) => (
                    <SectionSidebarRow
                      key={section.id}
                      active={activeSection === section.id}
                      label={section.label}
                      to={getSettingsSectionRoutePath(section.id)}
                    >
                      <SectionSidebarIcon name={section.icon} />
                    </SectionSidebarRow>
                  ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </SectionSidebar>
  );
}

export function SettingsSidebar({
  onResizeMouseDown,
  isResizing,
}: SettingsSidebarProps) {
  const navigation = useSettingsNavState();
  const searchConditions = useSettingsSearchConditions();
  const [searchActivated, setSearchActivated] = useState(false);
  const pluginSettings = usePluginSettingSearch({
    enabled: searchActivated,
    pluginEntries: navigation.pluginEntries,
  });

  return (
    <SettingsSidebarContent
      isResizing={isResizing}
      navigation={navigation}
      onResizeMouseDown={onResizeMouseDown}
      pluginSettingSearch={{
        entries: pluginSettings.entries,
        isLoading: pluginSettings.isLoading,
        onActivate: () => setSearchActivated(true),
      }}
      searchConditions={searchConditions}
    />
  );
}

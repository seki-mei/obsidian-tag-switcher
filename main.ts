import { App, Notice, Plugin, SuggestModal } from "obsidian";

const AYS_PLUGIN_ID = "obsidian-another-quick-switcher";
const AYS_SEARCH_PREFIX = `${AYS_PLUGIN_ID}:search-command_`;

// The two states this plugin can put things into. Symmetric on purpose:
// whether a state is reached for the first time via its Obsidian-configured
// hotkey, via Ctrl+Shift+Space/Ctrl+Alt+Space from inside AYS, or from
// inside the picker modal itself, the result is identical. No shortcuts
// that would make "trigger this action" behave differently depending on
// how you got here.
interface AysBackTargets {
  showNoteTags: () => void;
  showVaultTags: () => void;
}

// count is optional: note-mode entries don't have a meaningful per-tag
// count (getTagsForActiveFile just dedupes into a Set), only vault-mode
// entries carry one.
interface TagEntry {
  tag: string;
  count?: number;
}

// ── Tag picker modal ────────────────────────────────────────────────────────

class TagPickerModal extends SuggestModal<TagEntry> {
  private entries: TagEntry[];
  private onChoose: (tag: string) => void;

  // backTargets, if given, hardcodes the same Ctrl+Shift+Space /
  // Ctrl+Alt+Space combos used inside AYS — via Modal's own `this.scope`,
  // the real supported API for modal-local hotkeys (pushed onto Obsidian's
  // keymap stack on open, popped on close). Simpler and more robust than
  // the raw-DOM-listener approach openSwitcherWithQuery needs for AYS,
  // since we own this class and don't need to guess when it's mounted.
  constructor(
    app: App,
    entries: TagEntry[],
    onChoose: (tag: string) => void,
    backTargets?: AysBackTargets
  ) {
    super(app);
    this.entries = entries;
    this.setPlaceholder("Pick a tag…");
    this.onChoose = onChoose;

    if (backTargets) {
      this.scope.register(["Ctrl", "Shift"], " ", () => {
        this.close();
        backTargets.showNoteTags();
      });
      this.scope.register(["Ctrl", "Alt"], " ", () => {
        this.close();
        backTargets.showVaultTags();
      });
    }
  }

  getSuggestions(query: string): TagEntry[] {
    const q = query.toLowerCase();
    return this.entries.filter((e) => e.tag.toLowerCase().includes(q));
  }

  renderSuggestion(entry: TagEntry, el: HTMLElement): void {
    el.createEl("span", { text: entry.tag });
    if (entry.count !== undefined) {
      el.createEl("span", {
        text: ` (${entry.count})`,
        cls: "tag-switcher-count",
      });
    }
  }

  onChooseSuggestion(entry: TagEntry): void {
    this.onChoose(entry.tag);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTagsForActiveFile(app: App): string[] {
  const file = app.workspace.getActiveFile();
  if (!file) return [];
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return [];

  const tags = new Set<string>();

  // frontmatter tags (array or scalar)
  if (cache.frontmatter?.tags) {
    const ft = cache.frontmatter.tags;
    if (Array.isArray(ft)) ft.forEach((t: string) => tags.add("#" + t));
    else if (typeof ft === "string") tags.add("#" + ft);
  }

  // inline #tags
  cache.tags?.forEach((t) => tags.add(t.tag));

  return [...tags].sort();
}

// All tags known anywhere in the vault (frontmatter + inline), vault-wide.
//
// metadataCache.getTags() (returns { [tagWithHash]: count }) is NOT in the
// public Obsidian type defs — it's undocumented, present since ~1.4, and
// could change/disappear without notice. We cast through `any` and fall
// back to a manual per-file scan if it's missing, so the plugin degrades
// instead of throwing on some future Obsidian version.
function getAllVaultTags(app: App): TagEntry[] {
  const getTagsFn = (app.metadataCache as any).getTags;

  if (typeof getTagsFn === "function") {
    const tagCounts: Record<string, number> = getTagsFn.call(app.metadataCache);
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));
  }

  // Fallback: walk every markdown file's cache and dedupe (documented APIs only).
  const seen = new Map<string, number>();
  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) continue;

    if (cache.frontmatter?.tags) {
      const ft = cache.frontmatter.tags;
      const list = Array.isArray(ft) ? ft : typeof ft === "string" ? [ft] : [];
      for (const t of list) seen.set("#" + t, (seen.get("#" + t) ?? 0) + 1);
    }
    cache.tags?.forEach((t) => seen.set(t.tag, (seen.get(t.tag) ?? 0) + 1));
  }

  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));
}

// Find the best AYS command for tag-based search.
// AYS generates command IDs dynamically as:
//   obsidian-another-quick-switcher:search-command_${name.replace(/ /g,"-").toLowerCase()}
// We prefer a search command that has searchBy.tag enabled.
function findAYSTagCommand(app: App): string | null {
  const registeredCommands = (app as any).commands?.commands ?? {};
  const aysPlugin = (app as any).plugins?.plugins?.[AYS_PLUGIN_ID];
  if (!aysPlugin) return null;

  const searchCommands: any[] = aysPlugin.settings?.searchCommands ?? [];

  // Prefer the first search command with tag search enabled
  for (const sc of searchCommands) {
    if (!sc.searchBy?.tag || !sc.name?.trim()) continue;
    const id = `${AYS_SEARCH_PREFIX}${sc.name.replace(/ /g, "-").toLowerCase()}`;
    if (registeredCommands[id]) return id;
  }

  // Fall back to any registered AYS search command
  return Object.keys(registeredCommands).find((id) => id.startsWith(AYS_SEARCH_PREFIX)) ?? null;
}

// Open AYS with a pre-seeded query. Uses document.activeElement right after
// the modal mounts — more reliable than a fixed CSS selector.
//
// backTargets, if given, hardcodes two combos inside the AYS input:
//   Ctrl+Shift+Space -> close AYS, show the current note's tag picker
//   Ctrl+Alt+Space   -> close AYS, show the all-vault tag picker
// Both are always wired, regardless of which one got us into AYS in the
// first place — that's what makes them idempotent from the user's side.
//
// NOT Alt+Left/Escape — AYS itself binds Alt+Left to its own "Navigate
// Back" (and Escape to its own close) via Obsidian's Scope/keymap system,
// which resolves above plain DOM listeners, so a handler here would never
// see those keystrokes no matter how it's attached. Ctrl+Shift+Space and
// Ctrl+Alt+Space are unclaimed by both Obsidian core and AYS, so they reach
// us untouched. These two are currently hardcoded here rather than
// registered as real Obsidian hotkeys — deliberately, per your ask — so if
// you rebind the top-level commands' hotkeys later, these two stay fixed
// unless we come back and change them too.
//
// The listener is on the input itself and removes itself on any close path
// (blur is not enough since AYS may blur-then-refocus internally in some
// flows, so we also clean up via a MutationObserver watching for the input
// leaving the DOM).
function openSwitcherWithQuery(app: App, query: string, backTargets?: AysBackTargets): void {
  const commands = (app as any).commands;
  const aysCommand = findAYSTagCommand(app);

  if (!aysCommand) {
    new Notice("Tag Switcher: Another Quick Switcher is not installed or has no search commands.");
    return;
  }

  commands.executeCommandById(aysCommand);

  setTimeout(() => {
    const input = document.activeElement as HTMLInputElement | null;
    console.log("[TagSwitcher] post-executeCommand activeElement:", input, "tag:", input?.tagName);
    if (!input || input.tagName !== "INPUT") {
      console.log("[TagSwitcher] activeElement is not an INPUT — aborting, listener never attached");
      return;
    }
    input.value = query + " ";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    if (!backTargets) return;
    const activeInput = input; // narrowed non-null, captured for closures below
    console.log("[TagSwitcher] attaching Ctrl+Shift+Space / Ctrl+Alt+Space listeners to", activeInput);

    const handleKeydown = (ev: KeyboardEvent) => {
      console.log(
        "[TagSwitcher] keydown on AYS input:",
        ev.key,
        "code:", ev.code,
        "ctrl:", ev.ctrlKey,
        "shift:", ev.shiftKey,
        "alt:", ev.altKey
      );
      const isNoteCombo = ev.ctrlKey && ev.shiftKey && !ev.altKey && ev.code === "Space";
      const isVaultCombo = ev.ctrlKey && ev.altKey && !ev.shiftKey && ev.code === "Space";
      if (!isNoteCombo && !isVaultCombo) return;

      console.log("[TagSwitcher]", isNoteCombo ? "Ctrl+Shift+Space" : "Ctrl+Alt+Space", "matched, jumping");
      ev.preventDefault();
      ev.stopPropagation();
      cleanup();
      // AYS closes itself on Escape; simulate that to back out cleanly
      // before handing control back to the caller. Unlike the Alt+Left
      // case, this doesn't fight over a claimed binding — we WANT AYS's
      // own Escape handling to fire, just triggered programmatically.
      // Still unverified live: whether Obsidian's keymap dispatcher treats
      // a synthetic (non-isTrusted) KeyboardEvent the same as a real one.
      activeInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      console.log("[TagSwitcher] Escape dispatched, jumping to", isNoteCombo ? "note tags" : "vault tags");
      if (isNoteCombo) backTargets.showNoteTags();
      else backTargets.showVaultTags();
    };

    const observer = new MutationObserver(() => {
      if (!document.body.contains(activeInput)) cleanup();
    });

    function cleanup() {
      activeInput.removeEventListener("keydown", handleKeydown, true);
      observer.disconnect();
    }

    activeInput.addEventListener("keydown", handleKeydown, true);
    observer.observe(document.body, { childList: true, subtree: true });
  }, 50);
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default class TagSwitcherPlugin extends Plugin {
  async onload() {
    // No hotkeys assigned here — bind Ctrl+Shift+Space and Ctrl+Alt+Space
    // to these two in Settings → Hotkeys yourself. The matching combos
    // hardcoded inside openSwitcherWithQuery only fire once AYS is already
    // open; these commands are what get you there in the first place.
    this.addCommand({
      id: "open-tag-switcher",
      name: "Switch file by tag menu (current note's tags)",
      callback: () => this.openNoteTagSwitcher(),
    });

    this.addCommand({
      id: "open-vault-tag-switcher",
      name: "Switch file by tag menu (all vault tags)",
      callback: () => this.openVaultTagSwitcher(),
    });
  }

  // Reached via its own command/hotkey, via Ctrl+Shift+Space from inside
  // AYS, or via Ctrl+Shift+Space from inside the picker itself — all three
  // funnel through this one function, so the single-tag fast path below
  // applies uniformly everywhere for free. This is the one deliberate
  // exception to full idempotency: a single-tag note always jumps straight
  // to AYS rather than showing a redundant one-item list, even when the
  // jump is re-triggered from an AYS view that's already showing that tag
  // (in which case it just closes and reopens AYS with the same query —
  // a harmless no-op flicker, not a new state).
  private openNoteTagSwitcher(): void {
    const tags = getTagsForActiveFile(this.app);

    if (tags.length === 0) {
      new Notice("Tag Switcher: the active file has no tags.");
      return;
    }

    const backTargets: AysBackTargets = {
      showNoteTags: () => this.openNoteTagSwitcher(),
      showVaultTags: () => this.openVaultTagSwitcher(),
    };

    if (tags.length === 1) {
      openSwitcherWithQuery(this.app, tags[0], backTargets);
      return;
    }

    const entries: TagEntry[] = tags.map((tag) => ({ tag }));
    new TagPickerModal(this.app, entries, (tag) => {
      openSwitcherWithQuery(this.app, tag, backTargets);
    }, backTargets).open();
  }

  // Idempotent counterpart: always shows every tag in the vault, however
  // it's reached. No single-tag skip here — an empty-or-one-tag vault is
  // an edge case, not a case worth optimizing for like the per-note one is.
  private openVaultTagSwitcher(): void {
    const entries = getAllVaultTags(this.app);

    if (entries.length === 0) {
      new Notice("Tag Switcher: no tags found in this vault.");
      return;
    }

    const backTargets: AysBackTargets = {
      showNoteTags: () => this.openNoteTagSwitcher(),
      showVaultTags: () => this.openVaultTagSwitcher(),
    };

    new TagPickerModal(this.app, entries, (tag) => {
      openSwitcherWithQuery(this.app, tag, backTargets);
    }, backTargets).open();
  }
}

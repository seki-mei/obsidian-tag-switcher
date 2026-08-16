import { App, Notice, Plugin, SuggestModal } from "obsidian";

const AYS_PLUGIN_ID = "obsidian-another-quick-switcher";
const AYS_SEARCH_PREFIX = `${AYS_PLUGIN_ID}:search-command_`;

// ── Tag picker modal ────────────────────────────────────────────────────────

class TagPickerModal extends SuggestModal<string> {
  private tags: string[];
  private onChoose: (tag: string) => void;

  constructor(app: App, tags: string[], onChoose: (tag: string) => void) {
    super(app);
    this.tags = tags;
    this.setPlaceholder("Pick a tag…");
    this.onChoose = onChoose;
  }


  getSuggestions(query: string): string[] {
    const q = query.toLowerCase();
    return this.tags.filter((t) => t.toLowerCase().includes(q));
  }

  renderSuggestion(tag: string, el: HTMLElement): void {
    el.createEl("span", { text: tag });
  }

  onChooseSuggestion(tag: string): void {
    this.onChoose(tag);
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
function getAllVaultTags(app: App): string[] {
  const getTagsFn = (app.metadataCache as any).getTags;

  if (typeof getTagsFn === "function") {
    const tagCounts: Record<string, number> = getTagsFn.call(app.metadataCache);
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
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

  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
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
// onBack, if given, wires Alt+Left inside the AYS input to close AYS and
// invoke onBack (e.g. "reopen the tag list"). The listener is on the input
// itself and removes itself on any close path (blur is not enough since AYS
// may blur-then-refocus internally in some flows, so we also clean up via
// a MutationObserver watching for the input leaving the DOM).
function openSwitcherWithQuery(app: App, query: string, onBack?: () => void): void {
  const commands = (app as any).commands;
  const aysCommand = findAYSTagCommand(app);

  if (!aysCommand) {
    new Notice("Tag Switcher: Another Quick Switcher is not installed or has no search commands.");
    return;
  }

  commands.executeCommandById(aysCommand);

  setTimeout(() => {
    const input = document.activeElement as HTMLInputElement | null;
    if (!input || input.tagName !== "INPUT") return;
    input.value = query + " ";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    if (!onBack) return;
    const activeInput = input; // narrowed non-null, captured for closures below

    const handleKeydown = (ev: KeyboardEvent) => {
      if (!ev.altKey || ev.key !== "ArrowLeft") return;
      ev.preventDefault();
      ev.stopPropagation();
      cleanup();
      // AYS closes itself on Escape; simulate that to back out cleanly
      // before handing control back to the caller.
      activeInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      onBack();
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
    this.addCommand({
      id: "open-tag-switcher",
      name: "Switch file by tag menu",
      callback: () => this.openTagSwitcher(),
    });

    this.addCommand({
      id: "open-vault-tag-switcher",
      name: "Switch file by tag menu (all vault tags)",
      callback: () => this.openVaultTagSwitcher(),
    });
  }

  private openTagSwitcher(): void {
    const tags = getTagsForActiveFile(this.app);

    if (tags.length === 0) {
      new Notice("Tag Switcher: the active file has no tags.");
      return;
    }

    if (tags.length === 1) {
      // Only one tag — skip the picker, go straight to AYS filtered by it
      openSwitcherWithQuery(this.app, tags[0]);
      return;
    }

    new TagPickerModal(this.app, tags, (tag) => {
      openSwitcherWithQuery(this.app, tag);
    }).open();
  }

  // Vault-wide variant: always shows the picker (even for 1 tag, since
  // "all tags" implies browsing, not a quick single-tag jump), and lets
  // Alt+Left from inside AYS reopen this same picker.
  private openVaultTagSwitcher(): void {
    const tags = getAllVaultTags(this.app);

    if (tags.length === 0) {
      new Notice("Tag Switcher: no tags found in this vault.");
      return;
    }

    const showPicker = () => {
      new TagPickerModal(this.app, tags, (tag) => {
        openSwitcherWithQuery(this.app, tag, showPicker);
      }).open();
    };

    showPicker();
  }
}

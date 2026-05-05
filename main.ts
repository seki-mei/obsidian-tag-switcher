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
function openSwitcherWithQuery(app: App, query: string): void {
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
  }, 50);
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default class TagSwitcherPlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: "open-tag-switcher",
      name: "Switch file by tag (current file's tags)",
      callback: () => this.openTagSwitcher(),
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
}

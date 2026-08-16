var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TagSwitcherPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var AYS_PLUGIN_ID = "obsidian-another-quick-switcher";
var AYS_SEARCH_PREFIX = `${AYS_PLUGIN_ID}:search-command_`;
var TagPickerModal = class extends import_obsidian.SuggestModal {
  constructor(app, tags, onChoose) {
    super(app);
    __publicField(this, "tags");
    __publicField(this, "onChoose");
    this.tags = tags;
    this.setPlaceholder("Pick a tag\u2026");
    this.onChoose = onChoose;
  }
  getSuggestions(query) {
    const q = query.toLowerCase();
    return this.tags.filter((t) => t.toLowerCase().includes(q));
  }
  renderSuggestion(tag, el) {
    el.createEl("span", { text: tag });
  }
  onChooseSuggestion(tag) {
    this.onChoose(tag);
  }
};
function getTagsForActiveFile(app) {
  const file = app.workspace.getActiveFile();
  if (!file) return [];
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return [];
  const tags = /* @__PURE__ */ new Set();
  if (cache.frontmatter?.tags) {
    const ft = cache.frontmatter.tags;
    if (Array.isArray(ft)) ft.forEach((t) => tags.add("#" + t));
    else if (typeof ft === "string") tags.add("#" + ft);
  }
  cache.tags?.forEach((t) => tags.add(t.tag));
  return [...tags].sort();
}
function getAllVaultTags(app) {
  const getTagsFn = app.metadataCache.getTags;
  if (typeof getTagsFn === "function") {
    const tagCounts = getTagsFn.call(app.metadataCache);
    return Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  }
  const seen = /* @__PURE__ */ new Map();
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
function findAYSTagCommand(app) {
  const registeredCommands = app.commands?.commands ?? {};
  const aysPlugin = app.plugins?.plugins?.[AYS_PLUGIN_ID];
  if (!aysPlugin) return null;
  const searchCommands = aysPlugin.settings?.searchCommands ?? [];
  for (const sc of searchCommands) {
    if (!sc.searchBy?.tag || !sc.name?.trim()) continue;
    const id = `${AYS_SEARCH_PREFIX}${sc.name.replace(/ /g, "-").toLowerCase()}`;
    if (registeredCommands[id]) return id;
  }
  return Object.keys(registeredCommands).find((id) => id.startsWith(AYS_SEARCH_PREFIX)) ?? null;
}
function openSwitcherWithQuery(app, query, onBack) {
  const commands = app.commands;
  const aysCommand = findAYSTagCommand(app);
  if (!aysCommand) {
    new import_obsidian.Notice("Tag Switcher: Another Quick Switcher is not installed or has no search commands.");
    return;
  }
  commands.executeCommandById(aysCommand);
  setTimeout(() => {
    const input = document.activeElement;
    if (!input || input.tagName !== "INPUT") return;
    input.value = query + " ";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    if (!onBack) return;
    const activeInput = input;
    const handleKeydown = (ev) => {
      if (!ev.altKey || ev.key !== "ArrowLeft") return;
      ev.preventDefault();
      ev.stopPropagation();
      cleanup();
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
var TagSwitcherPlugin = class extends import_obsidian.Plugin {
  async onload() {
    this.addCommand({
      id: "open-tag-switcher",
      name: "Switch file by tag menu",
      callback: () => this.openTagSwitcher()
    });
    this.addCommand({
      id: "open-vault-tag-switcher",
      name: "Switch file by tag menu (all vault tags)",
      callback: () => this.openVaultTagSwitcher()
    });
  }
  openTagSwitcher() {
    const tags = getTagsForActiveFile(this.app);
    if (tags.length === 0) {
      new import_obsidian.Notice("Tag Switcher: the active file has no tags.");
      return;
    }
    if (tags.length === 1) {
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
  openVaultTagSwitcher() {
    const tags = getAllVaultTags(this.app);
    if (tags.length === 0) {
      new import_obsidian.Notice("Tag Switcher: no tags found in this vault.");
      return;
    }
    const showPicker = () => {
      new TagPickerModal(this.app, tags, (tag) => {
        openSwitcherWithQuery(this.app, tag, showPicker);
      }).open();
    };
    showPicker();
  }
};

"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TagSwitcherPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var { Notice } = import_obsidian;
var AYS_PLUGIN_ID = "obsidian-another-quick-switcher";
var AYS_SEARCH_PREFIX = AYS_PLUGIN_ID + ":search-command_";
var TagPickerModal = class extends import_obsidian.SuggestModal {
  constructor(app, tags, onChoose) {
    super(app);
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
  var _a, _b;
  const file = app.workspace.getActiveFile();
  if (!file)
    return [];
  const cache = app.metadataCache.getFileCache(file);
  if (!cache)
    return [];
  const tags = /* @__PURE__ */ new Set();
  if ((_a = cache.frontmatter) == null ? void 0 : _a.tags) {
    const ft = cache.frontmatter.tags;
    if (Array.isArray(ft))
      ft.forEach((t) => tags.add("#" + t));
    else if (typeof ft === "string")
      tags.add("#" + ft);
  }
  (_b = cache.tags) == null ? void 0 : _b.forEach((t) => tags.add(t.tag));
  return [...tags].sort();
}
function findAYSTagCommand(app) {
  var _a, _b, _c;
  const registeredCommands = ((_a = app.commands) == null ? void 0 : _a.commands) ?? {};
  const aysPlugin = (_c = (_b = app.plugins) == null ? void 0 : _b.plugins) == null ? void 0 : _c[AYS_PLUGIN_ID];
  if (!aysPlugin)
    return null;
  const searchCommands = ((_a = aysPlugin.settings) == null ? void 0 : _a.searchCommands) ?? [];
  for (const sc of searchCommands) {
    if (!sc.searchBy?.tag || !sc.name?.trim())
      continue;
    const id = AYS_SEARCH_PREFIX + sc.name.replace(/ /g, "-").toLowerCase();
    if (registeredCommands[id])
      return id;
  }
  return Object.keys(registeredCommands).find((id) => id.startsWith(AYS_SEARCH_PREFIX)) ?? null;
}
function openSwitcherWithQuery(app, query) {
  const commands = app.commands;
  const aysCommand = findAYSTagCommand(app);
  if (!aysCommand) {
    new Notice("Tag Switcher: Another Quick Switcher is not installed or has no search commands.");
    return;
  }
  commands.executeCommandById(aysCommand);
  setTimeout(() => {
    const input = document.activeElement;
    if (!input || input.tagName !== "INPUT")
      return;
    input.value = query + " ";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }, 50);
}
var TagSwitcherPlugin = class extends import_obsidian.Plugin {
  async onload() {
    this.addCommand({
      id: "open-tag-switcher",
      name: "Switch file by tag (current file's tags)",
      callback: () => this.openTagSwitcher()
    });
  }
  openTagSwitcher() {
    const tags = getTagsForActiveFile(this.app);
    if (tags.length === 0) {
      new Notice("Tag Switcher: the active file has no tags.");
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
};

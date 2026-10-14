// The Help menu's "Keyboard shortcuts" dialog. It lists the shortcuts the
// desktop implements as rows of keycap chips, in the style of GNOME's
// shortcuts window, through the dialog `render` hook. Every row documents a
// handler in another module, such as dash.ts for the Super tap or
// solitaire/index.ts for the table's keys. Update the table when a binding
// changes.

import { locale, t } from "./i18n";

interface ShortcutRow {
  /** Alternative combos; each combo is a list of keycap labels. */
  combos: string[][];
  desc: string;
  /** Mouse gestures render as flat pills instead of raised keycaps. */
  gesture?: boolean;
  /** Suppress the "+" joiner for combos whose keys are alternatives
   *  (e.g. H J K L), not a chord. */
  loose?: boolean;
}

export interface ShortcutSection {
  title: string;
  hint?: string;
  rows: ShortcutRow[];
}

/** The parts of the desktop a site can leave out. Each takes its
 *  shortcuts out of the dialog with it. */
export interface ShortcutSurfaces {
  /** The HUD and its Alt tap, which params.desktop.hud turns off. */
  hud: boolean;
  /** The sound indicator and its scroll wheel, which
   *  params.desktop.indicators can leave out. */
  volume: boolean;
  /** The home terminal, which params.home.layout = "page" replaces. */
  terminal: boolean;
  /** The blog's post lists, which a site without a blog section lacks. */
  blog: boolean;
  /** The projects grid, which a site without a page that sets
   *  layout = "projects" lacks. */
  projects: boolean;
  /** The solitaire table, which a site without a page that sets
   *  layout = "solitaire" lacks. */
  solitaire: boolean;
}

/** The section for the blog's post lists and the projects grid, which
 *  share their search and keyboard selection. Only the grid moves
 *  sideways and opens a context menu. Empty on a site with neither. */
function postAndProjectSections(has: ShortcutSurfaces): ShortcutSection[] {
  if (!has.blog && !has.projects) return [];
  let title = t("js_shortcuts_blog_projects");
  if (!has.projects) title = t("js_shortcuts_blog");
  else if (!has.blog) title = t("js_shortcuts_projects");
  return [{
    title,
    rows: [
      { combos: [["/"], ["Ctrl", "F"]], desc: t("js_shortcuts_search") },
      {
        combos: [[t("js_shortcuts_arrows")], has.projects ? ["H", "J", "K", "L"] : ["J", "K"]],
        desc: t("js_shortcuts_move_selection"),
        loose: true,
      },
      { combos: [["Enter"]], desc: t("js_shortcuts_open_selected") },
      ...(has.projects ? [{ combos: [["Shift", "F10"]], desc: t("js_shortcuts_context_menu") }] : []),
    ],
  }];
}

/** The dialog's sections for a desktop with the given surfaces. */
export function shortcutSections(has: ShortcutSurfaces): ShortcutSection[] {
  return [
    {
      title: t("js_shortcuts_desktop"),
      rows: [
        { combos: [["Super"]], desc: t("js_shortcuts_open_dash") },
        ...(has.hud ? [{ combos: [["Alt"]], desc: t("js_shortcuts_open_hud") }] : []),
        { combos: [["Esc"]], desc: t("js_shortcuts_dismiss") },
        { combos: [["Enter"]], desc: t("js_shortcuts_confirm_dialog") },
        { combos: [[t("js_shortcuts_drag")]], desc: t("js_shortcuts_move_window"), gesture: true },
        { combos: [[t("js_shortcuts_double_click")]], desc: t("js_shortcuts_maximize"), gesture: true },
        ...(has.volume ? [{ combos: [[t("js_shortcuts_scroll")]], desc: t("js_shortcuts_volume"), gesture: true }] : []),
      ],
    },
    {
      title: t("js_shortcuts_dash_hud"),
      hint: t("js_shortcuts_dash_hud_hint"),
      rows: [
        { combos: [[t("js_shortcuts_arrows")]], desc: t("js_shortcuts_move_results") },
        { combos: [["Enter"]], desc: t("js_shortcuts_open_best") },
        { combos: [["Tab"]], desc: t("js_shortcuts_jump_lens") },
      ],
    },
    ...postAndProjectSections(has),
    ...(has.solitaire ? [{
      title: t("js_shortcuts_solitaire"),
      hint: t("js_shortcuts_solitaire_hint"),
      rows: [
        { combos: [[t("js_shortcuts_drag")]], desc: t("js_shortcuts_move_cards"), gesture: true },
        { combos: [[t("js_shortcuts_arrows")]], desc: t("js_shortcuts_move_cursor") },
        { combos: [["Space"], ["Enter"]], desc: t("js_shortcuts_hold_place") },
        { combos: [["S"]], desc: t("js_shortcuts_draw_stock") },
        { combos: [["Z"], ["Ctrl", "Z"]], desc: t("js_shortcuts_undo") },
        { combos: [["H"]], desc: t("js_shortcuts_show_hint") },
        { combos: [["P"]], desc: t("js_shortcuts_play_hint") },
        { combos: [["N"]], desc: t("js_shortcuts_new_game") },
        { combos: [["A"]], desc: t("js_shortcuts_auto_finish") },
        { combos: [["D"]], desc: t("js_shortcuts_switch_draw") },
        { combos: [["M"]], desc: t("js_shortcuts_toggle_sound") },
        { combos: [["Esc"]], desc: t("js_shortcuts_drop_run") },
      ],
    }] : []),
    ...(has.terminal ? [{
      title: t("js_shortcuts_terminal"),
      hint: t("js_shortcuts_terminal_hint"),
      rows: [
        { combos: [["Ctrl", "A"], ["Ctrl", "E"]], desc: t("js_shortcuts_line_start_end") },
        { combos: [["Ctrl", "W"]], desc: t("js_shortcuts_delete_word") },
        { combos: [["Ctrl", "U"], ["Ctrl", "K"]], desc: t("js_shortcuts_cut_line") },
        { combos: [["Ctrl", "Y"]], desc: t("js_shortcuts_paste_cut") },
        { combos: [["Ctrl", "R"]], desc: t("js_shortcuts_search_history") },
        { combos: [["Ctrl", "L"]], desc: t("js_shortcuts_clear_screen") },
        { combos: [["Tab"]], desc: t("js_shortcuts_complete") },
        { combos: [["Shift", "Tab"]], desc: t("js_shortcuts_leave_terminal") },
        { combos: [[t("js_shortcuts_key_up")], [t("js_shortcuts_key_down")]], desc: t("js_shortcuts_step_history") },
      ],
    }] : []),
  ];
}

/** One piece of a row's keys: a combo, or the words that join two combos. */
export type KeyPart = { combo: readonly string[] } | { join: string };

/** A row's combos with the words between them, joined the way `lang`
 *  joins alternatives, such as "A, B, or C" in English. */
export function keyParts(combos: readonly (readonly string[])[], lang = locale()): KeyPart[] {
  const list = new Intl.ListFormat(lang, { type: "disjunction" });
  return list.formatToParts(combos.map((_, i) => String(i))).map((part) =>
    part.type === "element" ? { combo: combos[Number(part.value)] ?? [] } : { join: part.value.trim() });
}

function join(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "up-kbd-join";
  span.textContent = text;
  return span;
}

function buildKeys(row: ShortcutRow): HTMLElement {
  const keys = document.createElement("div");
  keys.className = "up-shortcut-keys";
  for (const part of keyParts(row.combos)) {
    if ("join" in part) {
      keys.appendChild(join(part.join));
      continue;
    }
    part.combo.forEach((label, ki) => {
      if (ki > 0 && !row.loose) keys.appendChild(join("+"));
      const kbd = document.createElement(row.gesture ? "span" : "kbd");
      kbd.className = row.gesture ? "up-kbd is-gesture" : "up-kbd";
      kbd.textContent = label;
      keys.appendChild(kbd);
    });
  }
  return keys;
}

function buildSection(section: ShortcutSection): HTMLElement {
  const el = document.createElement("section");
  el.className = "up-shortcut-section";

  const title = document.createElement("div");
  title.className = "up-shortcut-section-title";
  title.textContent = section.title;
  el.appendChild(title);

  if (section.hint) {
    const hint = document.createElement("div");
    hint.className = "up-shortcut-section-hint";
    hint.textContent = section.hint;
    el.appendChild(hint);
  }

  for (const row of section.rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "up-shortcut-row";
    const desc = document.createElement("div");
    desc.className = "up-shortcut-desc";
    desc.textContent = row.desc;
    rowEl.append(desc, buildKeys(row));
    el.appendChild(rowEl);
  }
  return el;
}

export function showShortcuts(): Promise<string | null> {
  return (
    window.uiDialog?.({
      icon: "none",
      title: t("js_shortcuts_title"),
      buttons: [{ id: "close", label: t("js_close"), primary: true }],
      render(content) {
        const list = document.createElement("div");
        list.className = "up-shortcuts";
        const site = window.UP_SITE;
        const sections = shortcutSections({
          hud: document.querySelector("[data-up-hud]") !== null,
          volume: document.querySelector('[data-indicator="vol"]') !== null,
          terminal: site?.terminal !== false,
          blog: site?.blog !== false,
          projects: site?.projects !== false,
          solitaire: site?.solitaire !== false,
        });
        list.append(...sections.map(buildSection));
        content.appendChild(list);
      },
    }) ?? Promise.resolve<string | null>(null)
  );
}

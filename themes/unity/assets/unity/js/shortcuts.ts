// The Help menu's "Keyboard shortcuts" dialog: a reference of the shortcuts
// the desktop actually implements, rendered as native rows of keycap chips
// (GNOME-shortcuts-window style) through the dialog `render` hook. Purely
// presentational — every row documents a handler that lives elsewhere
// (dialogs.ts, drag.ts, hud.ts for the Alt tap, top-panel.ts for the sound
// indicator's scroll wheel, page-window.ts, filter-nav.ts,
// projects-desktop.ts, shell/readline.ts, shell/terminal.ts for the Shift+Tab
// focus escape screenReaderMode enables); keep the table in sync when
// bindings change.

import { t } from "./i18n";

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

interface ShortcutSection {
  title: string;
  hint?: string;
  rows: ShortcutRow[];
}

// A site can turn the HUD off, and its Alt tap with it.
const hasHud = typeof document !== "undefined" && document.querySelector("[data-up-hud]") !== null;
// A site can leave the sound indicator out of params.desktop.indicators,
// and its scroll wheel with it.
const hasVolume = typeof document !== "undefined" && document.querySelector('[data-indicator="vol"]') !== null;

const SECTIONS: readonly ShortcutSection[] = [
  {
    title: t("js_shortcuts_desktop"),
    rows: [
      { combos: [["Super"]], desc: t("js_shortcuts_open_dash") },
      ...(hasHud ? [{ combos: [["Alt"]], desc: t("js_shortcuts_open_hud") }] : []),
      { combos: [["Esc"]], desc: t("js_shortcuts_dismiss") },
      { combos: [["Enter"]], desc: t("js_shortcuts_confirm_dialog") },
      { combos: [[t("js_shortcuts_drag")]], desc: t("js_shortcuts_move_window"), gesture: true },
      { combos: [[t("js_shortcuts_double_click")]], desc: t("js_shortcuts_maximize"), gesture: true },
      ...(hasVolume ? [{ combos: [[t("js_shortcuts_scroll")]], desc: t("js_shortcuts_volume"), gesture: true }] : []),
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
  {
    title: t("js_shortcuts_blog_projects"),
    rows: [
      { combos: [["/"], ["Ctrl", "F"]], desc: t("js_shortcuts_search") },
      { combos: [[t("js_shortcuts_arrows")], ["H", "J", "K", "L"]], desc: t("js_shortcuts_move_selection"), loose: true },
      { combos: [["Enter"]], desc: t("js_shortcuts_open_selected") },
      { combos: [["Shift", "F10"]], desc: t("js_shortcuts_context_menu") },
    ],
  },
  {
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
  },
  {
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
  },
];

function join(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "up-kbd-join";
  span.textContent = text;
  return span;
}

function buildKeys(row: ShortcutRow): HTMLElement {
  const keys = document.createElement("div");
  keys.className = "up-shortcut-keys";
  row.combos.forEach((combo, ci) => {
    if (ci > 0) keys.appendChild(join(t("js_shortcuts_or")));
    combo.forEach((label, ki) => {
      if (ki > 0 && !row.loose) keys.appendChild(join("+"));
      const kbd = document.createElement(row.gesture ? "span" : "kbd");
      kbd.className = row.gesture ? "up-kbd is-gesture" : "up-kbd";
      kbd.textContent = label;
      keys.appendChild(kbd);
    });
  });
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
        list.append(...SECTIONS.map(buildSection));
        content.appendChild(list);
      },
    }) ?? Promise.resolve<string | null>(null)
  );
}

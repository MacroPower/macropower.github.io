// The Help menu's "Keyboard shortcuts" dialog: a reference of the shortcuts
// the desktop actually implements, rendered as native rows of keycap chips
// (GNOME-shortcuts-window style) through the dialog `render` hook. Purely
// presentational — every row documents a handler that lives elsewhere
// (dialogs.ts, drag.ts, hud.ts for the Alt tap, top-panel.ts for the sound
// indicator's scroll wheel, page-window.ts, filter-nav.ts,
// projects-desktop.ts, shell/readline.ts, shell/terminal.ts for the Shift+Tab
// focus escape screenReaderMode enables); keep the table in sync when
// bindings change.

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

const SECTIONS: ShortcutSection[] = [
  {
    title: "Desktop",
    rows: [
      { combos: [["Super"]], desc: "Open the Dash (or click the launcher's top button)" },
      { combos: [["Alt"]], desc: "Open the HUD and search the menus" },
      { combos: [["Esc"]], desc: "Dismiss menus and dialogs" },
      { combos: [["Enter"]], desc: "Confirm the focused dialog" },
      { combos: [["Drag"]], desc: "Move a window or dialog (titlebar)", gesture: true },
      { combos: [["Double-click"]], desc: "Maximize or restore (titlebar)", gesture: true },
      { combos: [["Scroll"]], desc: "Adjust the volume (sound indicator)", gesture: true },
    ],
  },
  {
    title: "Dash & HUD",
    hint: "Esc clears the search first, then closes.",
    rows: [
      { combos: [["Arrows"]], desc: "Move between results" },
      { combos: [["Enter"]], desc: "Open the best match" },
      { combos: [["Tab"]], desc: "Jump to the expanders and lens bar (Dash)" },
    ],
  },
  {
    title: "Blog & Projects",
    rows: [
      { combos: [["/"], ["Ctrl", "F"]], desc: "Search" },
      { combos: [["Arrows"], ["H", "J", "K", "L"]], desc: "Move selection", loose: true },
      { combos: [["Enter"]], desc: "Open the selected item" },
      { combos: [["Shift", "F10"]], desc: "Open the context menu for the selection" },
    ],
  },
  {
    title: "Terminal",
    hint: "The usual bash/readline bindings.",
    rows: [
      { combos: [["Ctrl", "A"], ["Ctrl", "E"]], desc: "Start / end of line" },
      { combos: [["Ctrl", "W"]], desc: "Delete previous word" },
      { combos: [["Ctrl", "U"], ["Ctrl", "K"]], desc: "Cut to start / end of line" },
      { combos: [["Ctrl", "Y"]], desc: "Paste cut text" },
      { combos: [["Ctrl", "R"]], desc: "Search history" },
      { combos: [["Ctrl", "L"]], desc: "Clear the screen" },
      { combos: [["Tab"]], desc: "Complete commands and paths" },
      { combos: [["Shift", "Tab"]], desc: "Leave the terminal" },
      { combos: [["Up"], ["Down"]], desc: "Step through history" },
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
    if (ci > 0) keys.appendChild(join("or"));
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
      title: "Keyboard shortcuts",
      buttons: [{ id: "close", label: "Close", primary: true }],
      render(content) {
        const list = document.createElement("div");
        list.className = "up-shortcuts";
        list.append(...SECTIONS.map(buildSection));
        content.appendChild(list);
      },
    }) ?? Promise.resolve<string | null>(null)
  );
}

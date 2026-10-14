// Session-only preferences: reduce-motion and accent color. Nothing is
// persisted, so both reset on reload. The apply functions mutate the
// document directly, with a `body` class for reduce-motion and a
// `data-up-accent` attribute on `<html>` for the accent. Every rule that
// reads an `--up-accent` token or keys off `body.up-reduce-motion` then
// updates live.

import { t } from "./i18n";
import type { UPAccent } from "./types";

// The accent presets, from params.desktop.accents through UP_SITE. The
// theme's stylesheet holds a [data-up-accent="<name>"] rule for each one,
// and baseof.html names the page's starting preset on <html>.
function accents(): UPAccent[] {
  return window.UP_SITE?.accents ?? [];
}

// The body class is the single source of truth for reduce-motion (the CSS
// animation-kill keys off it), and the <html> attribute is the one for the
// accent.
function activeAccent(): string | undefined {
  return document.documentElement.dataset.upAccent;
}

export function isReduceMotion(): boolean {
  return document.body.classList.contains("up-reduce-motion");
}

// The behavior for every scroll a script starts. The CSS animation-kill
// cannot stop a smooth scroll that a script asks for, so scripts take the
// behavior from here instead of naming "smooth".
export function scrollBehavior(): ScrollBehavior {
  return isReduceMotion() ? "instant" : "smooth";
}

export function setReduceMotion(on: boolean): void {
  document.body.classList.toggle("up-reduce-motion", on);
}

// Sets reduce-motion from the visitor's system setting, then sets it again
// each time the setting changes, so the visitor does not have to reload.
// A choice in Preferences holds until the system setting next changes.
export function followSystemMotion(): void {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  setReduceMotion(query.matches);
  query.addEventListener("change", () => {
    setReduceMotion(query.matches);
  });
}

export function setAccent(name: string): void {
  if (!accents().some((a) => a.name === name)) return;
  document.documentElement.dataset.upAccent = name;
}

// The reduce-motion row, and a function that stops its switch following
// the body class.
function buildToggleRow(): [HTMLElement, () => void] {
  const row = document.createElement("div");
  row.className = "up-pref-row";

  const label = document.createElement("div");
  label.className = "up-pref-row-label";
  label.textContent = t("js_prefs_reduce_motion");
  const hint = document.createElement("span");
  hint.className = "up-pref-row-hint";
  hint.textContent = t("js_prefs_reduce_motion_hint");
  label.appendChild(hint);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "up-pref-toggle";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-label", t("js_prefs_reduce_motion"));
  const sync = (): void => {
    const on = isReduceMotion();
    toggle.classList.toggle("is-on", on);
    toggle.setAttribute("aria-checked", String(on));
  };
  sync();
  // A change to the system setting can flip the class while the dialog is
  // open, so the switch follows the class until the dialog closes.
  const watch = new MutationObserver(sync);
  watch.observe(document.body, { attributeFilter: ["class"] });
  toggle.addEventListener("click", () => {
    setReduceMotion(!isReduceMotion());
    sync();
  });

  row.append(label, toggle);
  return [row, () => { watch.disconnect(); }];
}

function buildAccentRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "up-pref-row";

  const label = document.createElement("div");
  label.className = "up-pref-row-label";
  label.textContent = t("js_prefs_accent_color");

  const swatches = document.createElement("div");
  swatches.className = "up-pref-swatches";
  swatches.setAttribute("role", "group");
  swatches.setAttribute("aria-label", t("js_prefs_accent_color"));

  // A screen reader learns the chosen swatch from aria-pressed, and the
  // stylesheet marks it through the class.
  const buttons = new Map<string, HTMLButtonElement>();
  const syncActive = (): void => {
    for (const [name, btn] of buttons) {
      const on = name === activeAccent();
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    }
  };
  for (const accent of accents()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "up-accent-swatch";
    // The swatch carries the preset's attribute, so the preset's rule
    // paints it in that preset's shades.
    btn.dataset.upAccent = accent.name;
    btn.setAttribute("aria-label", accent.label);
    btn.title = accent.label;
    btn.addEventListener("click", () => {
      setAccent(accent.name);
      syncActive();
    });
    buttons.set(accent.name, btn);
    swatches.appendChild(btn);
  }
  syncActive();

  row.append(label, swatches);
  return row;
}

export function showPreferences(): Promise<string | null> {
  const [motionRow, stopMotionRow] = buildToggleRow();
  const shown = window.uiDialog?.({
    icon: "none",
    title: t("js_prefs_title"),
    body: t("js_prefs_body"),
    buttons: [{ id: "close", label: t("js_close"), primary: true }],
    render(content) {
      content.append(motionRow);
      if (accents().length) content.append(buildAccentRow());
    },
  }) ?? Promise.resolve<string | null>(null);
  return shown.finally(stopMotionRow);
}

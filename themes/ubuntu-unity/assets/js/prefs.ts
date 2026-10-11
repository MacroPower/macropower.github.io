// Session-only preferences: reduce-motion and accent color. Nothing is
// persisted, so both reset on reload. The apply functions mutate the
// document directly (a `body` class for reduce-motion, a `data-up-accent`
// attribute on `<html>` for the accent) so every selector reading
// `var(--orange)` / `var(--orange-light)` or gated on `body.up-reduce-motion`
// updates live.

interface AccentDef {
  name: string;
  label: string;
}

// The accent presets. main.css holds each one's four shades under a
// [data-up-accent="<name>"] rule, and the site's params.accent picks the
// one <html> starts with. Keep the names in sync with main.css and the
// list in baseof.html.
const ACCENTS: AccentDef[] = [
  { name: "orange", label: "Orange" },
  { name: "green", label: "Green" },
  { name: "aubergine", label: "Aubergine" },
  { name: "blue", label: "Blue" },
];

// The body class is the single source of truth for reduce-motion (the CSS
// animation-kill keys off it), and the <html> attribute is the one for the
// accent. A page without the attribute shows the :root palette, which is
// orange unless the site's custom.css changes it.
function activeAccent(): string {
  return document.documentElement.dataset.upAccent ?? "orange";
}

export function isReduceMotion(): boolean {
  return document.body.classList.contains("up-reduce-motion");
}

export function setReduceMotion(on: boolean): void {
  document.body.classList.toggle("up-reduce-motion", on);
}

export function setAccent(name: string): void {
  if (!ACCENTS.some((a) => a.name === name)) return;
  document.documentElement.dataset.upAccent = name;
}

function buildToggleRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "up-pref-row";

  const label = document.createElement("div");
  label.className = "up-pref-row-label";
  label.textContent = "Reduce motion";
  const hint = document.createElement("span");
  hint.className = "up-pref-row-hint";
  hint.textContent = "Stop window and dialog animations.";
  label.appendChild(hint);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "up-pref-toggle";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-label", "Reduce motion");
  const sync = (): void => {
    const on = isReduceMotion();
    toggle.classList.toggle("is-on", on);
    toggle.setAttribute("aria-checked", String(on));
  };
  sync();
  toggle.addEventListener("click", () => {
    setReduceMotion(!isReduceMotion());
    sync();
  });

  row.append(label, toggle);
  return row;
}

function buildAccentRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "up-pref-row";

  const label = document.createElement("div");
  label.className = "up-pref-row-label";
  label.textContent = "Accent color";

  const swatches = document.createElement("div");
  swatches.className = "up-pref-swatches";

  const buttons = new Map<string, HTMLButtonElement>();
  const syncActive = (): void => {
    for (const [name, btn] of buttons) {
      btn.classList.toggle("is-active", name === activeAccent());
    }
  };
  for (const accent of ACCENTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "up-accent-swatch";
    // The swatch carries the preset's attribute, so the main.css rule paints
    // it in that preset's shades.
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
  return (
    window.uiDialog?.({
      icon: "none",
      title: "Preferences",
      body: "Session settings — these reset when you reload.",
      buttons: [{ id: "close", label: "Close", primary: true }],
      render(content) {
        content.append(buildToggleRow(), buildAccentRow());
      },
    }) ?? Promise.resolve<string | null>(null)
  );
}

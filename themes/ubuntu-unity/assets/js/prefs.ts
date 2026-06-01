// Session-only preferences: reduce-motion and accent color. Nothing is
// persisted — state lives in module scope and resets on reload. The apply
// functions mutate the document directly (a `body` class for reduce-motion,
// CSS custom properties on `:root` for the accent) so every selector reading
// `var(--orange)` / `var(--orange-light)` or gated on `body.up-reduce-motion`
// updates live.

interface AccentDef {
  name: string;
  label: string;
  base: string;
  light: string;
  dark: string;
  darker: string;
}

// Ubuntu-flavored palette. The four shades map to --orange / --orange-light /
// --orange-dark / --orange-darker so accent gradients (e.g. the primary dialog
// button) recolor on BOTH stops rather than fading into a fixed dark orange.
// Orange is the default and matches the values baked into :root in main.scss.
const ACCENTS: AccentDef[] = [
  { name: "orange", label: "Orange", base: "#DD4814", light: "#E95420", dark: "#B23B11", darker: "#922F0C" },
  { name: "green", label: "Green", base: "#3A7D2C", light: "#4E9E3A", dark: "#2E6322", darker: "#244F1B" },
  { name: "aubergine", label: "Aubergine", base: "#77216F", light: "#8B2A82", dark: "#5E1A57", darker: "#4A1444" },
  { name: "blue", label: "Blue", base: "#2A5F94", light: "#3F87C9", dark: "#224E79", darker: "#1A3C5E" },
];

const state = {
  reduceMotion: false,
  accent: "orange",
};

export function setReduceMotion(on: boolean): void {
  state.reduceMotion = on;
  document.body.classList.toggle("up-reduce-motion", on);
}

export function setAccent(name: string): void {
  const accent = ACCENTS.find((a) => a.name === name);
  if (!accent) return;
  state.accent = name;
  const root = document.documentElement;
  root.style.setProperty("--orange", accent.base);
  root.style.setProperty("--orange-light", accent.light);
  root.style.setProperty("--orange-dark", accent.dark);
  root.style.setProperty("--orange-darker", accent.darker);
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
  const sync = (): void => {
    toggle.classList.toggle("is-on", state.reduceMotion);
    toggle.setAttribute("aria-checked", String(state.reduceMotion));
  };
  sync();
  toggle.addEventListener("click", () => {
    setReduceMotion(!state.reduceMotion);
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
      btn.classList.toggle("is-active", name === state.accent);
    }
  };
  for (const accent of ACCENTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "up-accent-swatch";
    btn.style.background = accent.light;
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

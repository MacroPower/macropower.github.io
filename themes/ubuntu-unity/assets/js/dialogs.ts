import type {
  UPDialogButton,
  UPDialogIcon,
  UPDialogOptions,
} from "./types";

interface DialogEntry {
  id: number;
  root: HTMLElement;
  backdrop: HTMLElement;
  dialog: HTMLElement;
  buttons: UPDialogButton[];
  resolve: (value: string | null) => void;
}

const ICON_GLYPHS: Record<Exclude<UPDialogIcon, "none">, string> = {
  info: "i",
  question: "?",
  warning: "!",
  error: "✕",
  success: "✓",
};

let host: HTMLElement | null = null;
let template: HTMLTemplateElement | null = null;
const stack: DialogEntry[] = [];
let dialogSeq = 0;

function topDialog(): DialogEntry | null {
  return stack[stack.length - 1] ?? null;
}

function dismiss(id: number, value: string | null): void {
  const idx = stack.findIndex((d) => d.id === id);
  if (idx < 0) return;
  const [d] = stack.splice(idx, 1);
  if (!d) return;
  d.root.remove();
  d.resolve(value);
}

function shake(d: DialogEntry): void {
  d.dialog.classList.add("is-shaking");
  setTimeout(() => d.dialog.classList.remove("is-shaking"), 380);
}

function makeButton(d: DialogEntry, b: UPDialogButton, isLast: boolean): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "up-dlg-btn";
  if (b.primary) btn.classList.add("is-primary");
  if (b.danger) btn.classList.add("is-danger");
  btn.textContent = b.label;
  btn.addEventListener("click", () => dismiss(d.id, b.id));
  if (isLast) btn.setAttribute("data-dlg-primary-btn", "");
  return btn;
}

// Drag is inline (not via drag.ts) because the dialog stores its offset
// in CSS custom properties --ox/--oy so the dlgShake keyframe can compose
// with the drag offset. drag.ts writes transform directly, which would
// clobber the keyframe.
function installDialogDrag(d: DialogEntry): void {
  const titlebar = d.dialog.querySelector<HTMLElement>("[data-titlebar]");
  if (!titlebar) return;
  let ox = 0;
  let oy = 0;
  titlebar.addEventListener("mousedown", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button")) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const startOx = ox;
    const startOy = oy;
    d.dialog.classList.add("is-dragging");
    const move = (ev: MouseEvent): void => {
      ox = startOx + (ev.clientX - sx);
      oy = startOy + (ev.clientY - sy);
      d.dialog.style.setProperty("--ox", ox + "px");
      d.dialog.style.setProperty("--oy", oy + "px");
    };
    const up = (): void => {
      d.dialog.classList.remove("is-dragging");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
}

function uiDialog(opts: UPDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    if (!host || !template) {
      resolve(null);
      return;
    }
    const frag = template.content.cloneNode(true) as DocumentFragment;
    const root = document.createElement("div");
    root.className = "up-dialog-stage";
    root.style.zIndex = String(1000 + stack.length * 2);
    root.appendChild(frag);

    const backdrop = root.querySelector<HTMLElement>(".up-dlg-backdrop")!;
    const dialog = root.querySelector<HTMLElement>(".up-dialog")!;
    const titleEl = root.querySelector<HTMLElement>("[data-dlg-title]")!;
    const iconEl = root.querySelector<HTMLElement>("[data-dlg-icon]")!;
    const iconGlyph = root.querySelector<HTMLElement>("[data-dlg-icon-glyph]")!;
    const ctitleEl = root.querySelector<HTMLElement>("[data-dlg-content-title]")!;
    const cbodyEl = root.querySelector<HTMLElement>("[data-dlg-content-body]")!;
    const cdetailsEl = root.querySelector<HTMLElement>("[data-dlg-content-details]")!;
    const footerEl = root.querySelector<HTMLElement>("[data-dlg-footer]")!;
    const closeBtn = root.querySelector<HTMLElement>(".up-dlg-close")!;

    const title = opts.title ?? "";
    const body = opts.body ?? "";
    const details = opts.details ?? null;
    const icon = opts.icon ?? "info";
    const buttons = opts.buttons ?? [{ id: "ok", label: "Close", primary: true }];

    titleEl.textContent = title || "Information";
    dialog.setAttribute("aria-label", title);

    if (icon === "none") {
      iconEl.hidden = true;
    } else {
      iconEl.className = "up-dlg-icon up-dlg-icon-" + icon;
      iconGlyph.textContent = ICON_GLYPHS[icon];
    }

    if (title) {
      ctitleEl.textContent = title;
      ctitleEl.hidden = false;
      if (body) ctitleEl.classList.add("has-body");
    }
    if (body) {
      cbodyEl.textContent = body;
      cbodyEl.hidden = false;
    }
    if (details) {
      cdetailsEl.textContent = details;
      cdetailsEl.hidden = false;
    }

    const d: DialogEntry = {
      id: ++dialogSeq,
      root,
      backdrop,
      dialog,
      buttons,
      resolve,
    };

    buttons.forEach((b, i) => {
      footerEl.appendChild(makeButton(d, b, i === buttons.length - 1));
    });

    closeBtn.addEventListener("click", () => dismiss(d.id, null));
    backdrop.addEventListener("mousedown", () => {
      if (topDialog() === d) shake(d);
    });

    installDialogDrag(d);

    stack.push(d);
    host.appendChild(root);

    requestAnimationFrame(() => {
      backdrop.classList.add("is-appear");
      dialog.classList.add("is-appear");
      const primaryBtn = footerEl.querySelector<HTMLButtonElement>("[data-dlg-primary-btn]");
      primaryBtn?.focus();
    });
  });
}

export function initDialogs(): void {
  host = document.getElementById("up-dialog-host");
  template = document.getElementById("up-dialog-template") as HTMLTemplateElement | null;
  if (!host || !template) {
    console.warn("ubuntu-unity: #up-dialog-host or #up-dialog-template not found; dialogs disabled");
    return;
  }
  window.uiDialog = uiDialog;

  window.addEventListener("keydown", (e) => {
    const top = topDialog();
    if (!top) return;
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss(top.id, null);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const primary = top.buttons.find((b) => b.primary)
        ?? top.buttons[top.buttons.length - 1];
      if (primary) dismiss(top.id, primary.id);
    }
  });
}

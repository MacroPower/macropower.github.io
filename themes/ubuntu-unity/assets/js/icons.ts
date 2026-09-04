// The icon vault page (layouts/icons.html): per-section size and backdrop
// controls, and copy-to-clipboard on every tile. Ships only to pages with
// `layout = "icons"` and no-ops without a [data-icon-vault] root. The toast
// text is runtime English, like every other string JavaScript writes.

(function (): void {
  "use strict";

  const root = document.querySelector<HTMLElement>("[data-icon-vault]");
  if (!root) return;

  const toast = root.querySelector<HTMLElement>("[data-vault-toast]");
  let toastTimer = 0;
  function showToast(msg: string): void {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("is-shown");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-shown"), 2000);
  }

  // A segmented control: the clicked button becomes the active one and
  // `onPick` applies its value to the section's grid.
  function wireGroup(group: HTMLElement | null, onPick: (btn: HTMLButtonElement) => void): void {
    if (!group) return;
    group.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
      if (!btn) return;
      onPick(btn);
      for (const b of group.querySelectorAll("button")) b.classList.toggle("is-active", b === btn);
    });
  }

  for (const section of root.querySelectorAll<HTMLElement>(".up-icons-section")) {
    const grid = section.querySelector<HTMLElement>("[data-vault-grid]");
    if (!grid) continue;
    wireGroup(section.querySelector<HTMLElement>("[data-vault-size-group]"), (btn) => {
      grid.style.setProperty("--icp-size", `${btn.dataset.vaultSize ?? ""}px`);
    });
    wireGroup(section.querySelector<HTMLElement>("[data-vault-bg-group]"), (btn) => {
      grid.dataset.bg = btn.dataset.vaultBg ?? "light";
    });
  }

  // Strip the aria-hidden the icon partial adds and reflow one tag per line,
  // so the pasted markup reads like a hand-written asset.
  function tidy(svg: string): string {
    return svg
      .replace(/\s+aria-hidden="true"/, "")
      .replace(/></g, ">\n  <")
      .replace(/(\s*<\/svg>)$/, "\n</svg>")
      .trim();
  }

  function copyFallback(text: string): boolean {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  for (const cell of root.querySelectorAll<HTMLElement>("[data-vault-cell]")) {
    cell.addEventListener("click", () => {
      const svg = cell.querySelector<SVGElement>(".up-icons-art svg");
      if (!svg) return;
      const markup = tidy(svg.outerHTML);
      const name = cell.dataset.name ?? "";
      const done = (): void => {
        showToast(`copied · ${name}`);
        cell.classList.add("is-copied");
        window.setTimeout(() => cell.classList.remove("is-copied"), 600);
      };
      const failed = (): void => {
        showToast("copy failed; clipboard blocked");
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(markup).then(done, () => {
          if (copyFallback(markup)) done();
          else failed();
        });
      } else if (copyFallback(markup)) {
        done();
      } else {
        failed();
      }
    });
  }
})();

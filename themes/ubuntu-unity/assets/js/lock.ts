// Full-viewport lock screen (Ubuntu greeter style). Session-only, no
// persistence: showLock() reveals the SSR overlay, ticks a live clock, traps
// Esc, and unlocks on form submit (any input) or Esc. The overlay sits above
// the dialog stack (z-index 2000+) so it covers everything.

let root: HTMLElement | null = null;
let clockEl: HTMLElement | null = null;
let dateEl: HTMLElement | null = null;
let form: HTMLFormElement | null = null;
let input: HTMLInputElement | null = null;
let hintEl: HTMLElement | null = null;

let visible = false;
let tickTimer = 0;

function reduceMotion(): boolean {
  return (
    document.body.classList.contains("up-reduce-motion") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function tick(): void {
  const now = new Date();
  if (clockEl) {
    clockEl.textContent = now.toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  }
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString([], {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  }
}

function unlock(): void {
  if (!visible || !root) return;
  visible = false;
  if (tickTimer) { clearInterval(tickTimer); tickTimer = 0; }
  if (hintEl) hintEl.textContent = "";
  if (input) input.value = "";

  const finish = (): void => { if (root) root.hidden = true; };
  root.classList.remove("is-visible");
  if (reduceMotion()) {
    finish();
  } else {
    // Fade out, then hide once the opacity transition lands. A safety timeout
    // covers the case where transitionend never fires (e.g. tab backgrounded).
    let done = false;
    const onEnd = (): void => {
      if (done) return;
      done = true;
      root?.removeEventListener("transitionend", onEnd);
      finish();
    };
    root.addEventListener("transitionend", onEnd);
    setTimeout(onEnd, 400);
  }

  // Hand focus back to the page content.
  document.querySelector<HTMLElement>("[data-page-window]")?.focus?.();
}

export function showLock(): void {
  if (!root || visible) return;
  visible = true;
  if (hintEl) hintEl.textContent = "";
  if (input) input.value = "";
  root.hidden = false;
  tick();
  // Force a reflow so removing `hidden` and adding `is-visible` animate.
  void root.offsetWidth;
  root.classList.add("is-visible");
  tickTimer = window.setInterval(tick, 1000);
  input?.focus();
}

export function initLock(): void {
  root = document.querySelector<HTMLElement>("[data-up-lock]");
  if (!root) return;
  clockEl = root.querySelector<HTMLElement>("[data-lock-clock]");
  dateEl = root.querySelector<HTMLElement>("[data-lock-date]");
  form = root.querySelector<HTMLFormElement>("[data-lock-form]");
  input = root.querySelector<HTMLInputElement>("[data-lock-input]");
  hintEl = root.querySelector<HTMLElement>("[data-lock-hint]");

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (input && input.value.trim() === "") {
      // Any input unlocks; an empty submit gets the playful nudge.
      if (hintEl) hintEl.textContent = "Hint: just press Enter.";
    }
    unlock();
  });

  // Esc trap: when the overlay is visible, unlock and stop other window
  // keydown listeners (top-panel dropdown close) from also reacting. No-op
  // when hidden so a normal Esc still reaches those handlers.
  window.addEventListener("keydown", (e) => {
    if (!visible) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      unlock();
    }
  });
}

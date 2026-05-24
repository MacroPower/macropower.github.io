import { setTrashFocused, subscribe, getTrashFocused } from "./focus";

interface PageWindowState {
  visible: boolean;
  minimized: boolean;
  closed: boolean;
  maximized: boolean;
}

interface PageWindowStateWithFocus extends PageWindowState {
  focused: boolean;
}

export const WINDOW_STATE_EVENT = "up:page-window-state";

const damp = (d: number): number => {
  const s = Math.sign(d);
  const a = Math.abs(d);
  return s * (a / (1 + a / 260));
};

function getPageTile(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(".up-launcher-tile[data-page-current]")
    || document.querySelector<HTMLElement>(".up-launcher-tile.is-active:not([data-launcher-trash])")
  );
}

function emitState(state: PageWindowStateWithFocus): void {
  window.UP_PAGE_WINDOW_STATE = state;
  window.dispatchEvent(new CustomEvent(WINDOW_STATE_EVENT, { detail: state }));
}

export function installPageWindow(): void {
  const page = document.querySelector<HTMLElement>("[data-page-window]");
  if (!page) return;
  const stage = (page.closest<HTMLElement>(".up-window-stage") ?? page);
  const chrome = (stage.querySelector<HTMLElement>(".up-window-chrome") ?? page);

  const closeBtn = page.querySelector<HTMLElement>(".up-tl-close");
  const minBtn   = page.querySelector<HTMLElement>(".up-tl-min");
  const maxBtn   = page.querySelector<HTMLElement>(".up-tl-max");
  const titlebar = page.querySelector<HTMLElement>("[data-titlebar]");

  const pageTile = getPageTile();

  const state: PageWindowState = {
    visible: true,
    minimized: false,
    closed: false,
    maximized: false,
  };
  let transitioning = false;
  let springRaf: number | null = null;

  const isFocused = (): boolean => state.visible && !getTrashFocused();

  function syncFocus(): void {
    const focused = isFocused();
    stage.classList.toggle("is-focused", focused);
    chrome.classList.toggle("is-focused", focused);
    if (pageTile) {
      pageTile.classList.toggle("is-active", state.visible || state.minimized);
      pageTile.classList.toggle("is-focused", focused);
    }
    emitState({ ...state, focused });
  }

  function focusPageWindow(): void {
    if (!state.visible) return;
    if (!getTrashFocused()) {
      syncFocus();
      return;
    }
    // The subscribe callback below fires syncFocus when trash unfocuses.
    setTrashFocused(false);
  }

  function waitForTransition(el: HTMLElement, fallbackMs: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        el.removeEventListener("transitionend", onEnd);
        resolve();
      };
      const onEnd = (e: TransitionEvent): void => {
        if (e.target !== el) return;
        if (e.propertyName !== "transform") return;
        finish();
      };
      el.addEventListener("transitionend", onEnd);
      setTimeout(finish, fallbackMs);
    });
  }

  async function flyOut(): Promise<boolean> {
    if (transitioning) return false;
    const tile = pageTile;
    if (!tile) {
      stage.style.visibility = "hidden";
      return true;
    }
    const tr = tile.getBoundingClientRect();
    const cr = chrome.getBoundingClientRect();
    const tx = (tr.left + tr.width / 2) - (cr.left + cr.width / 2);
    const ty = (tr.top + tr.height / 2) - (cr.top + cr.height / 2);

    chrome.style.transformOrigin = "center";
    chrome.style.transition = "transform .28s cubic-bezier(.4,0,.7,.4), opacity .22s ease";
    chrome.style.transform = `translate(${tx}px, ${ty}px) scale(.06)`;
    chrome.style.opacity = "0";
    transitioning = true;
    await waitForTransition(chrome, 400);
    stage.style.visibility = "hidden";
    chrome.style.transition = "";
    transitioning = false;
    return true;
  }

  async function flyIn(): Promise<boolean> {
    if (transitioning) return false;
    stage.style.visibility = "";
    // Force layout so the shrunk transform is committed before we animate back.
    chrome.getBoundingClientRect();
    chrome.style.transition = "transform .3s cubic-bezier(.2,.8,.3,1), opacity .22s ease";
    chrome.style.transform = "";
    chrome.style.opacity = "";
    transitioning = true;
    await waitForTransition(chrome, 420);
    chrome.style.transition = "";
    chrome.style.transformOrigin = "";
    transitioning = false;
    return true;
  }

  async function minimize(): Promise<void> {
    if (!state.visible || transitioning) return;
    const ok = await flyOut();
    if (!ok) return;
    state.visible = false;
    state.minimized = true;
    state.closed = false;
    syncFocus();
  }

  async function close(): Promise<void> {
    if ((!state.visible && !state.minimized) || transitioning) return;
    const ok = await flyOut();
    if (!ok) return;
    state.visible = false;
    state.minimized = false;
    state.closed = true;
    syncFocus();
  }

  async function restore(): Promise<void> {
    if (state.visible || transitioning) return;
    if (pageTile) pageTile.classList.add("is-active");
    const ok = await flyIn();
    if (!ok) return;
    state.visible = true;
    state.minimized = false;
    state.closed = false;
    setTrashFocused(false);
    syncFocus();
  }

  function toggleMaximize(): void {
    state.maximized = !state.maximized;
    stage.classList.toggle("is-maximized", state.maximized);
    emitState({ ...state, focused: isFocused() });
  }

  closeBtn?.addEventListener("click", (e) => { e.stopPropagation(); void close(); });
  minBtn?.addEventListener("click",   (e) => { e.stopPropagation(); void minimize(); });
  maxBtn?.addEventListener("click",   (e) => { e.stopPropagation(); toggleMaximize(); });

  titlebar?.addEventListener("dblclick", (e) => {
    const target = e.target as Element | null;
    if (target?.closest("button")) return;
    toggleMaximize();
  });

  if (pageTile) {
    // Active page tile mirrors Unity's dock cycle: focus, minimize, restore.
    pageTile.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.visible) {
        void restore();
      } else if (!isFocused()) {
        focusPageWindow();
      } else {
        void minimize();
      }
    });
  }

  subscribe(syncFocus);
  syncFocus();

  /* ----- Rubber-band drag on title bar ---------------------------------- */
  const apply = (dx: number, dy: number): void => {
    page.style.transform = (dx === 0 && dy === 0)
      ? ""
      : `translate3d(${dx}px, ${dy}px, 0)`;
  };

  page.addEventListener("mousedown", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    focusPageWindow();
    if (state.maximized) return;
    if (transitioning) return;

    const tb = target.closest<HTMLElement>("[data-titlebar]");
    if (!tb) return;
    if (target.closest("button")) return;
    e.preventDefault();

    if (springRaf != null) {
      cancelAnimationFrame(springRaf);
      springRaf = null;
    }
    const startX = e.clientX;
    const startY = e.clientY;

    let cur = { dx: 0, dy: 0 };
    const move = (ev: MouseEvent): void => {
      cur = {
        dx: damp(ev.clientX - startX),
        dy: damp(ev.clientY - startY),
      };
      apply(cur.dx, cur.dy);
    };
    const up = (): void => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      let x = cur.dx;
      let y = cur.dy;
      let vx = 0;
      let vy = 0;
      const stiffness = 320;
      const damping = 26;
      const mass = 1;
      let lastT = performance.now();
      const step = (now: number): void => {
        let dt = (now - lastT) / 1000;
        lastT = now;
        if (dt > 0.032) dt = 0.032;
        const ax = (-stiffness * x - damping * vx) / mass;
        const ay = (-stiffness * y - damping * vy) / mass;
        vx += ax * dt;
        vy += ay * dt;
        x  += vx * dt;
        y  += vy * dt;
        if (Math.abs(x) < 0.3 && Math.abs(y) < 0.3
            && Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) {
          apply(0, 0);
          springRaf = null;
          return;
        }
        apply(x, y);
        springRaf = requestAnimationFrame(step);
      };
      springRaf = requestAnimationFrame(step);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
}

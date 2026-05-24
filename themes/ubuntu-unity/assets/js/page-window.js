import { setTrashFocused, subscribe, getTrashFocused } from "./focus.js";

const damp = (d) => {
  const s = Math.sign(d);
  const a = Math.abs(d);
  return s * (a / (1 + a / 260));
};

function getPageTile() {
  return document.querySelector(".up-launcher-tile[data-page-current]")
      || document.querySelector(".up-launcher-tile.is-active:not([data-launcher-trash])");
}

export const WINDOW_STATE_EVENT = "up:page-window-state";

function emitState(state) {
  window.UP_PAGE_WINDOW_STATE = state;
  window.dispatchEvent(new CustomEvent(WINDOW_STATE_EVENT, { detail: state }));
}

export function installPageWindow() {
  const page = document.querySelector("[data-page-window]");
  if (!page) return;
  const stage = page.closest(".up-window-stage") || page;
  const chrome = stage.querySelector(".up-window-chrome") || page;

  const closeBtn = page.querySelector(".up-tl-close");
  const minBtn   = page.querySelector(".up-tl-min");
  const maxBtn   = page.querySelector(".up-tl-max");
  const titlebar = page.querySelector("[data-titlebar]");

  const pageTile = getPageTile();

  let state = { visible: true, minimized: false, closed: false, maximized: false };
  let transitioning = false;
  let springRaf = null;

  const isFocused = () => state.visible && !getTrashFocused();

  function syncFocus() {
    const focused = isFocused();
    stage.classList.toggle("is-focused", focused);
    chrome.classList.toggle("is-focused", focused);
    if (pageTile) {
      pageTile.classList.toggle("is-active", state.visible || state.minimized);
      pageTile.classList.toggle("is-focused", focused);
    }
    emitState({ ...state, focused });
  }

  function focusPageWindow() {
    if (!state.visible) return;
    if (!getTrashFocused()) {
      syncFocus();
      return;
    }
    // The subscribe callback below will fire syncFocus when trash unfocuses.
    setTrashFocused(false);
  }

  function waitForTransition(el, fallbackMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener("transitionend", onEnd);
        resolve();
      };
      const onEnd = (e) => {
        if (e.target !== el) return;
        if (e.propertyName !== "transform") return;
        finish();
      };
      el.addEventListener("transitionend", onEnd);
      setTimeout(finish, fallbackMs);
    });
  }

  async function flyOut() {
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

  async function flyIn() {
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

  async function minimize() {
    if (!state.visible || transitioning) return;
    const ok = await flyOut();
    if (!ok) return;
    state.visible = false;
    state.minimized = true;
    state.closed = false;
    syncFocus();
  }

  async function close() {
    if ((!state.visible && !state.minimized) || transitioning) return;
    const ok = await flyOut();
    if (!ok) return;
    state.visible = false;
    state.minimized = false;
    state.closed = true;
    syncFocus();
  }

  async function restore() {
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

  function toggleMaximize() {
    state.maximized = !state.maximized;
    stage.classList.toggle("is-maximized", state.maximized);
    emitState({ ...state, focused: isFocused() });
  }

  if (closeBtn) closeBtn.addEventListener("click", (e) => { e.stopPropagation(); close(); });
  if (minBtn)   minBtn.addEventListener("click",   (e) => { e.stopPropagation(); minimize(); });
  if (maxBtn)   maxBtn.addEventListener("click",   (e) => { e.stopPropagation(); toggleMaximize(); });

  if (titlebar) {
    titlebar.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      toggleMaximize();
    });
  }

  if (pageTile) {
    // active page tile behaves like Unity's dock: cycles between focus, minimize, restore
    pageTile.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.visible) {
        restore();
      } else if (!isFocused()) {
        focusPageWindow();
      } else {
        minimize();
      }
    });
  }

  subscribe(syncFocus);
  syncFocus();

  /* ----- Rubber-band drag on title bar ---------------------------------- */
  const apply = (dx, dy) => {
    page.style.transform = (dx === 0 && dy === 0)
      ? ""
      : `translate3d(${dx}px, ${dy}px, 0)`;
  };

  page.addEventListener("mousedown", (e) => {
    if (!(e.target instanceof Element)) return;
    focusPageWindow();
    if (state.maximized) return;
    if (transitioning) return;

    const tb = e.target.closest("[data-titlebar]");
    if (!tb) return;
    if (e.target.closest("button")) return;
    e.preventDefault();

    if (springRaf) {
      cancelAnimationFrame(springRaf);
      springRaf = null;
    }
    const startX = e.clientX, startY = e.clientY;

    let cur = { dx: 0, dy: 0 };
    const move = (ev) => {
      cur = {
        dx: damp(ev.clientX - startX),
        dy: damp(ev.clientY - startY),
      };
      apply(cur.dx, cur.dy);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      let x = cur.dx, y = cur.dy;
      let vx = 0, vy = 0;
      const stiffness = 320;
      const damping = 26;
      const mass = 1;
      let lastT = performance.now();
      const step = (now) => {
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

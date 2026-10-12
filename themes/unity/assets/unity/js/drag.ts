export interface InstallTitlebarDragOptions {
  yMin?: number;
  spring?: boolean;
  titlebarSelector?: string;
  gate?: () => boolean;
}

// The window's position is expressed purely as the translate3d offset owned
// here (inline left/top never change post-SSR). The handle exposes that
// offset so collaborators — resize.ts moving the origin for north/west
// resizes — go through the same state instead of fighting the transform.
export interface DragHandle {
  dispose(): void;
  getOffset(): { x: number; y: number };
  setOffset(x: number, y: number): void;
}

// Canceling a pointerdown suppresses its compatibility mousedown, but the
// chrome-level focus handlers (trash.ts, page-window.ts) rely on a bubbling
// mousedown to raise their window. Gesture starts that preventDefault their
// pointerdown re-dispatch a synthetic mousedown so focus-on-press survives
// the Pointer Events port. Untrusted events trigger no default actions, so
// the selection/focus suppression the preventDefault buys is preserved.
export function dispatchCompatMousedown(e: PointerEvent): void {
  if (!(e.target instanceof Element)) return;
  e.target.dispatchEvent(new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: e.clientX,
    clientY: e.clientY,
    screenX: e.screenX,
    screenY: e.screenY,
    button: e.button,
    buttons: e.buttons,
  }));
}

const damp = (d: number): number => {
  const s = Math.sign(d);
  const a = Math.abs(d);
  return s * (a / (1 + a / 260));
};

export function installTitlebarDrag(
  el: HTMLElement,
  opts: InstallTitlebarDragOptions = {},
): DragHandle {
  const titlebarSelector = opts.titlebarSelector ?? "[data-titlebar]";
  const spring = opts.spring !== false;
  const yMin = opts.yMin;

  let springRaf: number | null = null;
  let baseX = 0;
  let baseY = 0;
  let activeId: number | null = null;

  const cancelSpring = (): void => {
    if (springRaf != null) {
      cancelAnimationFrame(springRaf);
      springRaf = null;
    }
  };

  const apply = (dx: number, dy: number): void => {
    el.style.transform = (dx === 0 && dy === 0)
      ? ""
      : `translate3d(${dx}px, ${dy}px, 0)`;
  };

  const onPointerDown = (e: PointerEvent): void => {
    // Primary button only: a right-mousedown opens the context menu, which
    // swallows the matching up and would leave the window glued to the
    // pointer. A non-primary touch is a second finger mid-gesture.
    if (e.button !== 0 || !e.isPrimary || activeId !== null) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (opts.gate && !opts.gate()) return;
    const tb = target.closest<HTMLElement>(titlebarSelector);
    if (!tb || !el.contains(tb)) return;
    if (target.closest("button")) return;
    e.preventDefault();
    dispatchCompatMousedown(e);
    cancelSpring();

    const id = e.pointerId;
    activeId = id;
    const startX = e.clientX;
    const startY = e.clientY;
    const originX = baseX;
    const originY = baseY;
    const rect = el.getBoundingClientRect();
    const untransformedTop = rect.top - originY;

    let cur = { dx: originX, dy: originY };
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== id) return;
      let dx: number;
      let dy: number;
      if (spring) {
        dx = damp(ev.clientX - startX);
        dy = damp(ev.clientY - startY);
      } else {
        dx = originX + (ev.clientX - startX);
        dy = originY + (ev.clientY - startY);
        if (yMin != null) {
          const minDy = yMin - untransformedTop;
          if (dy < minDy) dy = minDy;
        }
      }
      cur = { dx, dy };
      apply(dx, dy);
    };

    // pointerup and pointercancel land here alike: a cancelled gesture
    // (e.g. the browser reclaiming the touch) releases exactly like a drop.
    const finish = (ev: PointerEvent): void => {
      if (ev.pointerId !== id) return;
      activeId = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      try { tb.releasePointerCapture(id); } catch { /* not captured */ }
      if (!spring) {
        baseX = cur.dx;
        baseY = cur.dy;
        return;
      }
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
        x += vx * dt;
        y += vy * dt;
        if (Math.abs(x) < 0.3 && Math.abs(y) < 0.3
            && Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) {
          apply(0, 0);
          baseX = 0;
          baseY = 0;
          springRaf = null;
          return;
        }
        apply(x, y);
        springRaf = requestAnimationFrame(step);
      };
      springRaf = requestAnimationFrame(step);
    };

    // Capture on the titlebar, not the chrome: capture retargets the
    // pointerup, and the browser synthesizes click/dblclick at that target.
    // Capturing on the chrome would starve the titlebar's dblclick-to-
    // maximize handlers (page-window.ts, daw.ts). Movement tracking is
    // unaffected — move/finish listen on window.
    try { tb.setPointerCapture(id); } catch { /* unsupported */ }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  el.addEventListener("pointerdown", onPointerDown);

  return {
    dispose: () => {
      el.removeEventListener("pointerdown", onPointerDown);
      cancelSpring();
    },
    getOffset: () => ({ x: baseX, y: baseY }),
    setOffset: (x, y) => {
      cancelSpring();
      baseX = x;
      baseY = y;
      apply(x, y);
    },
  };
}

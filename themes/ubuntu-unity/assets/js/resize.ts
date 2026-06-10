import { dispatchCompatMousedown, type DragHandle } from "./drag";

export interface InstallResizeOptions {
  minW: number;
  minH: number;
  yMin?: number;            // viewport-top clamp for the north edge
  gate?: () => boolean;     // suppress while maximized
  onStart?: () => void;     // called as a resize gesture begins
  handle: DragHandle;       // shared position offset from installTitlebarDrag
}

interface Dir {
  cls: string;
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

const DIRS: Dir[] = [
  { cls: "up-resize-n", top: true },
  { cls: "up-resize-s", bottom: true },
  { cls: "up-resize-w", left: true },
  { cls: "up-resize-e", right: true },
  { cls: "up-resize-nw", top: true, left: true },
  { cls: "up-resize-ne", top: true, right: true },
  { cls: "up-resize-sw", bottom: true, left: true },
  { cls: "up-resize-se", bottom: true, right: true },
];

// Drag-to-resize from all 8 edges/corners via thin invisible hit-zone divs
// appended to the window chrome. Size is applied as inline width/height;
// north/west resizes move the window origin through the shared DragHandle so
// drag and resize never disagree about position. Pointer Events (capture +
// pointercancel) so touch resizes too, matching drag.ts; the zones carry
// touch-action:none in main.scss, with fatter coarse-pointer hit zones.
export function installResize(
  el: HTMLElement,
  opts: InstallResizeOptions,
): () => void {
  const { minW, minH, yMin, handle } = opts;
  const zones: HTMLElement[] = [];
  let active = false;

  for (const dir of DIRS) {
    const zone = document.createElement("div");
    zone.className = `up-resize-handle ${dir.cls}`;
    zone.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !e.isPrimary || active) return;
      if (opts.gate && !opts.gate()) return;
      e.preventDefault();
      // No stopPropagation, and canceling pointerdown suppresses the compat
      // mousedown the chrome-level focus handlers rely on — re-dispatch it so
      // grabbing a handle still focuses the window.
      dispatchCompatMousedown(e);
      opts.onStart?.();
      active = true;

      const id = e.pointerId;
      const startRect = el.getBoundingClientRect();
      const start = handle.getOffset();
      const startX = e.clientX;
      const startY = e.clientY;

      // Lock the zone's own CSS cursor on the body so the pointer doesn't
      // flicker when it overshoots the thin strip mid-gesture. Read before
      // adding up-resizing — its cursor:inherit override would otherwise
      // resolve the zone's computed cursor to the body's (still-unset) one.
      document.body.style.cursor = getComputedStyle(zone).cursor;
      document.body.classList.add("up-resizing");

      const move = (ev: PointerEvent): void => {
        if (ev.pointerId !== id) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let ox = start.x;
        let oy = start.y;

        if (dir.right) {
          el.style.width = `${Math.max(minW, startRect.width + dx)}px`;
        } else if (dir.left) {
          // Clamp size to min first, then derive the applied origin shift
          // from the clamped size, so clamping and position stay in lockstep.
          const w = Math.max(minW, startRect.width - dx);
          el.style.width = `${w}px`;
          ox = start.x + (startRect.width - w);
        }
        if (dir.bottom) {
          el.style.height = `${Math.max(minH, startRect.height + dy)}px`;
        } else if (dir.top) {
          let h = Math.max(minH, startRect.height - dy);
          if (yMin != null) {
            const maxH = startRect.top + startRect.height - yMin;
            if (h > maxH) h = maxH;
          }
          el.style.height = `${h}px`;
          oy = start.y + (startRect.height - h);
        }
        if (dir.left || dir.top) handle.setOffset(ox, oy);
      };

      // pointercancel releases the same way pointerup does: the size applied
      // so far stays, the cursor lock comes off.
      const finish = (ev: PointerEvent): void => {
        if (ev.pointerId !== id) return;
        active = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        try { zone.releasePointerCapture(id); } catch { /* not captured */ }
        document.body.classList.remove("up-resizing");
        document.body.style.cursor = "";
      };

      try { zone.setPointerCapture(id); } catch { /* unsupported */ }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    });
    el.appendChild(zone);
    zones.push(zone);
  }

  // Removing the zones removes their pointerdown handlers with them; a gesture
  // already in flight keeps its window listeners until its own pointerup.
  return () => {
    for (const zone of zones) zone.remove();
    zones.length = 0;
  };
}

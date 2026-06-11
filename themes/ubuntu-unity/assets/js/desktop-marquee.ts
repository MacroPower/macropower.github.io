// Rubber-band marquee on the bare desktop (the wallpaper behind every
// window). The desktop has no icons, so the band selects nothing — it
// exists so the wallpaper answers a click-drag the way a real Unity
// desktop does. Reuses the .up-marquee box from the icon grids; at
// z-index 5 it paints above the wallpaper layers and under all chrome.
//
// The page-window stage is pointer-events:none with children re-enabled,
// so a press on empty desktop falls through to #root (or <body>). Every
// other surface — panel, launcher, windows, overlays, dialog backdrops —
// is its own element, so the target check alone gates the gesture.

// Same press-to-drag threshold as the icon grids' marquee.
const DRAG_THRESHOLD = 4;

export function initDesktopMarquee(): void {
  let marquee: HTMLDivElement | null = null;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let moved = false;

  const ensureMarquee = (): HTMLDivElement => {
    if (!marquee) {
      marquee = document.createElement("div");
      marquee.className = "up-marquee";
      marquee.hidden = true;
      document.body.appendChild(marquee);
    }
    return marquee;
  };

  function onMove(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    if (!moved) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      moved = true;
      ensureMarquee().hidden = false;
    }
    // The desktop never scrolls (html/body are height:100%), so client
    // coordinates are body coordinates; clamp to the viewport so a captured
    // pointer leaving the window can't grow the band past the wallpaper.
    const x = Math.max(0, Math.min(e.clientX, window.innerWidth));
    const y = Math.max(0, Math.min(e.clientY, window.innerHeight));
    const m = ensureMarquee();
    m.style.left = `${Math.min(startX, x)}px`;
    m.style.top = `${Math.min(startY, y)}px`;
    m.style.width = `${Math.abs(x - startX)}px`;
    m.style.height = `${Math.abs(y - startY)}px`;
  }

  function endGesture(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    pointerId = -1;
    if (marquee) marquee.hidden = true;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", endGesture);
    window.removeEventListener("pointercancel", endGesture);
  }

  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || pointerId !== -1) return;
    const target = e.target as HTMLElement;
    if (target !== document.body && target.id !== "root") return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
    try { target.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endGesture);
    window.addEventListener("pointercancel", endGesture);
  });
}

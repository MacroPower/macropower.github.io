import { setTrashFocused } from "./focus.js";

const damp = (d) => {
  const s = Math.sign(d);
  const a = Math.abs(d);
  return s * (a / (1 + a / 260));
};

export function installPageRubberBand() {
  const page = document.querySelector("[data-page-window]");
  if (!page) return;

  let springRaf = null;

  const apply = (dx, dy) => {
    page.style.transform = (dx === 0 && dy === 0)
      ? ""
      : `translate3d(${dx}px, ${dy}px, 0)`;
  };

  page.addEventListener("mousedown", (e) => {
    if (!(e.target instanceof Element)) return;
    setTrashFocused(false);

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

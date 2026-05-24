export interface InstallTitlebarDragOptions {
  yMin?: number;
  spring?: boolean;
  titlebarSelector?: string;
  gate?: () => boolean;
}

const damp = (d: number): number => {
  const s = Math.sign(d);
  const a = Math.abs(d);
  return s * (a / (1 + a / 260));
};

export function installTitlebarDrag(
  el: HTMLElement,
  opts: InstallTitlebarDragOptions = {},
): () => void {
  const titlebarSelector = opts.titlebarSelector ?? "[data-titlebar]";
  const spring = opts.spring !== false;
  const yMin = opts.yMin;

  let springRaf: number | null = null;
  let baseX = 0;
  let baseY = 0;

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

  const onMouseDown = (e: MouseEvent): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (opts.gate && !opts.gate()) return;
    const tb = target.closest<HTMLElement>(titlebarSelector);
    if (!tb || !el.contains(tb)) return;
    if (target.closest("button")) return;
    e.preventDefault();
    cancelSpring();

    const startX = e.clientX;
    const startY = e.clientY;
    const originX = baseX;
    const originY = baseY;

    let cur = { dx: originX, dy: originY };
    const move = (ev: MouseEvent): void => {
      let dx: number;
      let dy: number;
      if (spring) {
        dx = damp(ev.clientX - startX);
        dy = damp(ev.clientY - startY);
      } else {
        dx = originX + (ev.clientX - startX);
        dy = originY + (ev.clientY - startY);
        if (yMin != null && dy < yMin) dy = yMin;
      }
      cur = { dx, dy };
      apply(dx, dy);
    };

    const up = (): void => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
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

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  el.addEventListener("mousedown", onMouseDown);

  return () => {
    el.removeEventListener("mousedown", onMouseDown);
    cancelSpring();
  };
}

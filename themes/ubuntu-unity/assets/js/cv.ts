// The CV page's Evince-style document viewer. Renders the PDF named by
// [data-cv-viewer]'s data-pdf-url through the vendored pdf.js build under
// static/js/pdf-js/ (the parent site vendors it; _partials/page/cv.html emits
// its deferred <script> tag): every page becomes a sheet in the scrollable
// page well, plus a clickable thumbnail rail and a toolbar with page-number /
// zoom controls. Zoom is fit-to-width until the user zooms explicitly; the
// fit relayouts on view resizes (window maximize, phone rotation) via a
// ResizeObserver. Session-only; no persistence.

interface PdfViewport {
  width: number;
  height: number;
}
interface PdfPage {
  getViewport(opts: { scale: number }): PdfViewport;
  render(opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }): { promise: Promise<void> };
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}
interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(url: string): { promise: Promise<PdfDocument> };
}

(function (): void {
  "use strict";

  const root = document.querySelector<HTMLElement>("[data-cv-viewer]");
  if (!root) return;
  const url = root.dataset.pdfUrl;
  if (!url) return;

  const viewQ = root.querySelector<HTMLElement>("[data-docv-view]");
  const pagesQ = root.querySelector<HTMLElement>("[data-docv-pages]");
  const thumbsQ = root.querySelector<HTMLElement>("[data-docv-thumbs]");
  if (!viewQ || !pagesQ || !thumbsQ) return;
  // Re-bind past the guard: narrowing on the queried consts does not reach
  // into the hoisted function declarations below.
  const view = viewQ;
  const pagesEl = pagesQ;
  const thumbsEl = thumbsQ;
  const loadingEl = root.querySelector<HTMLElement>("[data-docv-loading]");
  const errorEl = root.querySelector<HTMLElement>("[data-docv-error]");
  const pageInput = root.querySelector<HTMLInputElement>("[data-docv-pagenum]");
  const pageCount = root.querySelector<HTMLElement>("[data-docv-pagecount]");
  const prevBtn = root.querySelector<HTMLButtonElement>("[data-docv-prev]");
  const nextBtn = root.querySelector<HTMLButtonElement>("[data-docv-next]");
  const zoomOutBtn = root.querySelector<HTMLButtonElement>("[data-docv-zoom-out]");
  const zoomInBtn = root.querySelector<HTMLButtonElement>("[data-docv-zoom-in]");
  const zoomFitBtn = root.querySelector<HTMLButtonElement>("[data-docv-zoom-fit]");
  const zoomReadout = root.querySelector<HTMLElement>("[data-docv-zoom-readout]");

  // 100% means the PDF's own point size at CSS 96dpi, matching Evince.
  const PT_TO_CSS = 96 / 72;
  const ZOOM_STEPS = [0.5, 0.7, 0.85, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  // CSS px width of a thumbnail; .up-docv-thumb-frame is sized by its canvas.
  const THUMB_WIDTH = 104;
  // Backing-store cap (CSS scale x devicePixelRatio) so deep zoom on a hidpi
  // screen cannot allocate absurd canvases.
  const MAX_RENDER_SCALE = 5;

  let doc: PdfDocument | null = null;
  let pdfPages: PdfPage[] = [];
  let sheets: HTMLElement[] = [];
  let canvases: HTMLCanvasElement[] = [];
  let thumbs: HTMLButtonElement[] = [];
  let thumbCanvases: HTMLCanvasElement[] = [];
  let maxPagePtWidth = 0;
  let current = 1;
  let fitWidth = true;
  let scale = PT_TO_CSS; // CSS px per PDF point, as laid out
  let lastFitPx = 0; // fit-width target of the last layout, for resize dedupe
  let generation = 0; // invalidates in-flight page renders on relayout

  function reduceMotion(): boolean {
    return document.body.classList.contains("up-reduce-motion");
  }

  // pdf.min.js is a deferred UMD script emitted before this (also deferred)
  // bundle, so its global normally exists by the time we run; the listener
  // path only covers a still-pending tag.
  function pdfjs(): Promise<PdfJsModule> {
    const get = (): PdfJsModule | undefined =>
      (window as unknown as Record<string, PdfJsModule | undefined>)[
        "pdfjs-dist/build/pdf"
      ];
    const now = get();
    if (now) return Promise.resolve(now);
    return new Promise((resolve, reject) => {
      const tag = document.querySelector<HTMLScriptElement>("script[data-docv-pdfjs]");
      if (!tag) {
        reject(new Error("pdf.js script tag missing"));
        return;
      }
      tag.addEventListener("load", () => {
        const mod = get();
        if (mod) resolve(mod);
        else reject(new Error("pdf.js loaded without its global"));
      });
      tag.addEventListener("error", () => reject(new Error("pdf.js failed to load")));
    });
  }

  function availWidth(): number {
    const cs = getComputedStyle(pagesEl);
    return (
      pagesEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    );
  }

  function fitScale(): number {
    if (maxPagePtWidth <= 0) return PT_TO_CSS;
    return Math.max(0.1, availWidth() / maxPagePtWidth);
  }

  function updateZoomUI(): void {
    const pct = (scale / PT_TO_CSS) * 100;
    if (zoomReadout) zoomReadout.textContent = `${Math.round(pct)}%`;
    const z = scale / PT_TO_CSS;
    if (zoomOutBtn) zoomOutBtn.disabled = !doc || z <= ZOOM_STEPS[0] + 1e-3;
    if (zoomInBtn)
      zoomInBtn.disabled = !doc || z >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 1e-3;
    if (zoomFitBtn) zoomFitBtn.setAttribute("aria-pressed", String(fitWidth));
  }

  /** Sizes and (re)renders every sheet at the current scale. Each page paints
   *  into an offscreen canvas first and blits on completion, so a zoom keeps
   *  showing the previous rendering instead of flashing blank sheets. */
  function layout(): void {
    if (fitWidth) {
      scale = fitScale();
      lastFitPx = availWidth();
    }
    generation++;
    const gen = generation;
    const dpr = window.devicePixelRatio || 1;
    const out = Math.max(1, Math.min(dpr, MAX_RENDER_SCALE / scale));
    pdfPages.forEach((page, i) => {
      const canvas = canvases[i];
      const vp = page.getViewport({ scale });
      canvas.style.width = `${Math.floor(vp.width)}px`;
      canvas.style.height = `${Math.floor(vp.height)}px`;
      const rvp = page.getViewport({ scale: scale * out });
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.floor(rvp.width));
      off.height = Math.max(1, Math.floor(rvp.height));
      const ctx = off.getContext("2d");
      if (!ctx) return;
      page
        .render({ canvasContext: ctx, viewport: rvp })
        .promise.then(() => {
          if (gen !== generation) return; // superseded by a newer layout
          canvas.width = off.width;
          canvas.height = off.height;
          canvas.getContext("2d")?.drawImage(off, 0, 0);
        })
        .catch(() => {
          /* stale or failed render; the sheet keeps its last paint */
        });
    });
    updateZoomUI();
  }

  /** Relayout keeping the point at the vertical center of the view fixed,
   *  proportionally — the closest cheap equivalent of Evince's anchored zoom. */
  function relayoutAnchored(): void {
    const ratio =
      (view.scrollTop + view.clientHeight / 2) / Math.max(1, view.scrollHeight);
    layout();
    view.scrollTop = ratio * view.scrollHeight - view.clientHeight / 2;
  }

  function setCurrent(n: number): void {
    current = n;
    if (pageInput) pageInput.value = String(n);
    if (prevBtn) prevBtn.disabled = n <= 1;
    if (nextBtn) nextBtn.disabled = !doc || n >= doc.numPages;
    thumbs.forEach((t, i) => {
      const active = i === n - 1;
      t.classList.toggle("is-active", active);
      if (active) {
        t.setAttribute("aria-current", "page");
        t.scrollIntoView({ block: "nearest" });
      } else {
        t.removeAttribute("aria-current");
      }
    });
  }

  function goTo(n: number): void {
    if (!doc) return;
    const target = Math.min(Math.max(1, n), doc.numPages);
    const sheet = sheets[target - 1];
    if (!sheet) return;
    // A little breathing room above the sheet, mirroring the well's padding.
    const top = Math.max(0, sheet.offsetTop - 14);
    view.scrollTo({ top, behavior: reduceMotion() ? "auto" : "smooth" });
    setCurrent(target);
  }

  /** The page owning the reference line a third down the viewport is current. */
  function spy(): void {
    if (!sheets.length) return;
    const ref = view.scrollTop + view.clientHeight / 3;
    let n = 1;
    for (let i = 0; i < sheets.length; i++) {
      if (sheets[i].offsetTop <= ref) n = i + 1;
    }
    if (n !== current) setCurrent(n);
  }

  function zoomStep(dir: 1 | -1): void {
    const cur = scale / PT_TO_CSS;
    const next =
      dir > 0
        ? ZOOM_STEPS.find((z) => z > cur + 1e-3)
        : [...ZOOM_STEPS].reverse().find((z) => z < cur - 1e-3);
    if (next === undefined) return;
    fitWidth = false;
    scale = next * PT_TO_CSS;
    relayoutAnchored();
  }

  function renderThumb(page: PdfPage, canvas: HTMLCanvasElement): void {
    const base = page.getViewport({ scale: 1 });
    const s = THUMB_WIDTH / Math.max(1, base.width);
    const out = Math.min(window.devicePixelRatio || 1, 3);
    const vp = page.getViewport({ scale: s * out });
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    canvas.style.width = `${THUMB_WIDTH}px`;
    canvas.style.height = `${Math.floor(vp.height / out)}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    page.render({ canvasContext: ctx, viewport: vp }).promise.catch(() => {
      /* a blank thumbnail frame is an acceptable degradation */
    });
  }

  function buildDom(numPages: number): void {
    for (let n = 1; n <= numPages; n++) {
      const sheet = document.createElement("div");
      sheet.className = "up-docv-sheet";
      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Page ${n}`);
      sheet.appendChild(canvas);
      pagesEl.appendChild(sheet);
      sheets.push(sheet);
      canvases.push(canvas);

      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "up-docv-thumb";
      thumb.setAttribute("aria-label", `Go to page ${n}`);
      const frame = document.createElement("span");
      frame.className = "up-docv-thumb-frame";
      const tc = document.createElement("canvas");
      frame.appendChild(tc);
      const num = document.createElement("span");
      num.className = "up-docv-thumb-num";
      num.textContent = String(n);
      thumb.append(frame, num);
      thumb.addEventListener("click", () => goTo(n));
      thumbsEl.appendChild(thumb);
      thumbs.push(thumb);
      thumbCanvases.push(tc);
    }
  }

  function showError(err: unknown): void {
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) errorEl.hidden = false;
    console.error("CV viewer failed:", err);
  }

  prevBtn?.addEventListener("click", () => goTo(current - 1));
  nextBtn?.addEventListener("click", () => goTo(current + 1));
  zoomOutBtn?.addEventListener("click", () => zoomStep(-1));
  zoomInBtn?.addEventListener("click", () => zoomStep(1));
  zoomFitBtn?.addEventListener("click", () => {
    if (fitWidth) return;
    fitWidth = true;
    relayoutAnchored();
  });

  function commitPageInput(): void {
    if (!pageInput) return;
    const n = parseInt(pageInput.value, 10);
    if (Number.isFinite(n)) goTo(n);
    else if (doc) pageInput.value = String(current);
  }
  pageInput?.addEventListener("change", commitPageInput);
  pageInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitPageInput();
    }
  });

  let scrollRaf = 0;
  view.addEventListener("scroll", () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      spy();
    });
  });

  // Ctrl+wheel zoom, like Evince (and every document viewer since).
  view.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey || !doc) return;
      e.preventDefault();
      zoomStep(e.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );

  // Re-fit on real width changes only — maximize/restore, phone rotation,
  // the phone media query dropping the thumbnail rail.
  let resizeRaf = 0;
  new ResizeObserver(() => {
    if (!doc || !fitWidth) return;
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      if (Math.abs(availWidth() - lastFitPx) < 1) return;
      relayoutAnchored();
    });
  }).observe(view);

  pdfjs()
    .then((mod) => {
      if (mod.GlobalWorkerOptions.workerSrc === "") {
        mod.GlobalWorkerOptions.workerSrc =
          root.dataset.pdfjsWorker ?? "/js/pdf-js/build/pdf.worker.min.js";
      }
      return mod.getDocument(url).promise;
    })
    .then(async (d) => {
      doc = d;
      pdfPages = await Promise.all(
        Array.from({ length: d.numPages }, (_, i) => d.getPage(i + 1)),
      );
      maxPagePtWidth = Math.max(
        ...pdfPages.map((p) => p.getViewport({ scale: 1 }).width),
      );
      if (pageCount) pageCount.textContent = String(d.numPages);
      buildDom(d.numPages);
      if (loadingEl) loadingEl.hidden = true;
      pdfPages.forEach((p, i) => renderThumb(p, thumbCanvases[i]));
      for (const el of [pageInput, prevBtn, nextBtn, zoomOutBtn, zoomInBtn, zoomFitBtn]) {
        if (el) el.disabled = false;
      }
      layout();
      setCurrent(1);
    })
    .catch(showError);
})();

// NotifyOSD — the dark passive notification bubbles from Ubuntu's notify-osd
// daemon. Two slots, mirroring the real daemon's layout: a "synchronous"
// bubble on top (volume/brightness-style icon + value bar, replaced in place
// on every update) and an asynchronous text bubble below it (icon + summary +
// body, queued one at a time). Bubbles are strictly passive: the host is
// pointer-events:none so clicks fall through to whatever is underneath, and a
// document-level mousemove hit-test veils a bubble the pointer crosses —
// notify-osd's signature "look through me" fade. Session-only, like prefs.ts:
// nothing persists, and every timer/element lives in module state torn down
// by its own removal path.
//
// The desktop side (top-panel.ts) calls notify()/notifyValue() directly; the
// home page's terminal reaches the daemon from its separate bundle via the
// literal "up:notify" CustomEvent (see NOTIFY_EVENT below and the cross-bundle
// notes in CLAUDE.md — same rename-risk class as "up:page-window-state").

import { isReduceMotion } from "./prefs";

export const NOTIFY_EVENT = "up:notify";

export interface NotifyOpts {
  title: string;
  body?: string;
  /** A key from the SSR'd icon template (info, warning, music, ...) or a
   *  freedesktop-style alias (dialog-information, audio-volume-high, ...). */
  icon?: string;
  /** Display time; clamped to 1–20s like notify-send's expire-time. */
  timeoutMs?: number;
}

export interface NotifyValueOpts {
  /** Bar fill, 0–100. */
  value: number;
  icon?: string;
  /** Screen-reader text for the otherwise text-free bubble. */
  label?: string;
}

const TEXT_TIMEOUT = 5000;
const VALUE_TIMEOUT = 2000;
const QUEUE_MAX = 3;
const FADE_MS = 300;

// freedesktop icon names (what notify-send users will reach for) mapped onto
// the keys the SSR'd template actually ships. Unknown names simply render no
// icon, matching the real daemon's behavior for a missing theme icon.
const ICON_ALIASES: Record<string, string> = {
  "dialog-information": "info",
  "dialog-warning": "warning",
  "dialog-error": "warning",
  "dialog-question": "question",
  "emblem-default": "success",
  "audio-volume-high": "volume",
  "audio-volume-medium": "volume",
  "audio-volume-low": "volume",
  "audio-volume-muted": "volume-muted",
  "notification-audio-volume-high": "volume",
  "notification-audio-volume-muted": "volume-muted",
  "network-wireless": "network",
  "nm-device-wireless": "network",
  "battery-good": "battery",
  "emblem-favorite": "heart",
  "security-high": "lock",
  "utilities-terminal": "terminal",
  "audio-x-generic": "music",
  "emblem-music": "music",
};

let host: HTMLElement | null = null;
const icons = new Map<string, Element>();

interface Bubble {
  el: HTMLElement;
  timer: number;
}

let textBubble: (Bubble & { key: string }) | null = null;
let valueBubble: (Bubble & { fill: HTMLElement; iconBox: HTMLElement; srText: Text }) | null = null;
const queue: NotifyOpts[] = [];
let watchingPointer = false;

function resolveIcon(name: string | undefined): Element | null {
  if (!name) return null;
  const key = icons.has(name) ? name : ICON_ALIASES[name];
  const tpl = key ? icons.get(key) : undefined;
  return tpl ? tpl.cloneNode(true) as Element : null;
}

// notify-osd's "veil": bubbles never take input, but a pointer resting on one
// turns it translucent so the content underneath stays readable. Because the
// host is pointer-events:none we can't use :hover — a document mousemove
// hit-test (only attached while a bubble is up) does the job instead.
function onPointerMove(e: MouseEvent): void {
  for (const b of [textBubble, valueBubble]) {
    if (!b) continue;
    const r = b.el.getBoundingClientRect();
    const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    b.el.classList.toggle("is-veiled", over);
  }
}

function syncPointerWatch(): void {
  const want = Boolean(textBubble || valueBubble);
  if (want === watchingPointer) return;
  watchingPointer = want;
  if (want) document.addEventListener("mousemove", onPointerMove);
  else document.removeEventListener("mousemove", onPointerMove);
}

function reveal(el: HTMLElement): void {
  // Mount hidden, force a reflow, then fade — the lock/dash reveal pattern.
  void el.offsetWidth;
  el.classList.add("is-visible");
}

function dismiss(b: Bubble, after?: () => void): void {
  window.clearTimeout(b.timer);
  // transitionend (~250ms) and the backstop timeout (300ms) race; finish must
  // be one-shot or `after` double-fires and double-advances the text queue.
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    b.el.removeEventListener("transitionend", finish);
    b.el.remove();
    after?.();
    syncPointerWatch();
  };
  b.el.classList.remove("is-visible");
  if (isReduceMotion()) {
    finish();
  } else {
    b.el.addEventListener("transitionend", finish);
    window.setTimeout(finish, FADE_MS);
  }
}

function buildBubble(extra?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "up-notify-bubble" + (extra ? ` ${extra}` : "");
  return el;
}

function showText(opts: NotifyOpts): void {
  if (!host) return;
  const el = buildBubble();
  const icon = resolveIcon(opts.icon);
  if (icon) {
    const box = document.createElement("span");
    box.className = "up-notify-icon";
    box.setAttribute("aria-hidden", "true");
    box.append(icon);
    el.append(box);
  }
  const text = document.createElement("div");
  text.className = "up-notify-text";
  const title = document.createElement("div");
  title.className = "up-notify-title";
  title.textContent = opts.title;
  text.append(title);
  if (opts.body) {
    const body = document.createElement("div");
    body.className = "up-notify-body";
    body.textContent = opts.body;
    text.append(body);
  }
  el.append(text);
  host.append(el);
  reveal(el);

  const b = { el, key: contentKey(opts), timer: 0 };
  armTextTimer(b, opts.timeoutMs);
  textBubble = b;
  syncPointerWatch();
}

const contentKey = (o: NotifyOpts): string => `${o.title}\n${o.body ?? ""}`;

function armTextTimer(b: NonNullable<typeof textBubble>, timeoutMs?: number): void {
  window.clearTimeout(b.timer);
  const timeout = timeoutMs !== undefined ? Math.min(20000, Math.max(1000, timeoutMs)) : TEXT_TIMEOUT;
  b.timer = window.setTimeout(() => {
    // Free the slot the moment expiry starts, not when the fade lands: a
    // notification arriving mid-fade must see an empty slot (and show fresh,
    // cross-fading with the dying bubble) rather than renew a condemned one.
    if (textBubble === b) textBubble = null;
    dismiss(b, () => {
      // A bubble mounted during the fade owns the screen; don't advance over it.
      if (textBubble) return;
      const next = queue.shift();
      if (next) showText(next);
    });
  }, timeout);
}

/** Post an asynchronous text bubble (queued behind the one on screen). */
export function notify(opts: NotifyOpts): void {
  if (!host || !opts.title) return;
  if (textBubble) {
    // notify-osd's replace semantics: an identical summary+body just renews
    // the bubble on screen (and never piles up duplicates in the queue).
    if (textBubble.key === contentKey(opts)) {
      armTextTimer(textBubble, opts.timeoutMs);
      return;
    }
    if (queue.some((q) => contentKey(q) === contentKey(opts))) return;
    queue.push(opts);
    if (queue.length > QUEUE_MAX) queue.shift();
    return;
  }
  showText(opts);
}

/** Post (or update in place) the synchronous icon + value-bar bubble. */
export function notifyValue(opts: NotifyValueOpts): void {
  if (!host) return;
  const value = Math.min(100, Math.max(0, Math.round(opts.value)));
  const label = opts.label ?? `${value}%`;

  if (valueBubble) {
    // Synchronous bubbles update in place — a volume drag is one bubble
    // tracking the slider, not a stack of stale ones.
    valueBubble.fill.style.width = `${value}%`;
    valueBubble.iconBox.replaceChildren(resolveIcon(opts.icon) ?? "");
    valueBubble.srText.textContent = label;
    window.clearTimeout(valueBubble.timer);
    const b = valueBubble;
    b.timer = window.setTimeout(() => {
      if (valueBubble === b) valueBubble = null;
      dismiss(b);
    }, VALUE_TIMEOUT);
    return;
  }

  const el = buildBubble("is-value");
  const iconBox = document.createElement("span");
  iconBox.className = "up-notify-icon";
  iconBox.setAttribute("aria-hidden", "true");
  const icon = resolveIcon(opts.icon);
  if (icon) iconBox.append(icon);
  el.append(iconBox);
  const bar = document.createElement("span");
  bar.className = "up-notify-bar";
  const fill = document.createElement("span");
  fill.className = "up-notify-bar-fill";
  fill.style.width = `${value}%`;
  bar.append(fill);
  el.append(bar);
  const sr = document.createElement("span");
  sr.className = "up-sr-only";
  const srText = document.createTextNode(label);
  sr.append(srText);
  el.append(sr);
  // Synchronous slot sits above the text slot regardless of arrival order.
  host.prepend(el);
  reveal(el);

  const b = {
    el,
    fill,
    iconBox,
    srText,
    timer: window.setTimeout(() => {
      if (valueBubble === b) valueBubble = null;
      dismiss(b);
    }, VALUE_TIMEOUT),
  };
  valueBubble = b;
  syncPointerWatch();
}

export function initNotify(): void {
  host = document.querySelector<HTMLElement>("[data-up-notify]");
  if (!host) return;

  const tpl = host.querySelector<HTMLTemplateElement>("[data-notify-icons]");
  if (tpl) {
    for (const child of Array.from(tpl.content.children)) {
      const key = child.getAttribute("data-icon");
      const svg = child.firstElementChild;
      if (key && svg) icons.set(key, svg);
    }
  }

  // The terminal lives in its own bundle (js/shell.js) and can't import this
  // module; notify-send raises bubbles through this event instead.
  window.addEventListener(NOTIFY_EVENT, (e) => {
    const d = (e as CustomEvent<{ summary?: unknown; body?: unknown; icon?: unknown; timeoutMs?: unknown }>).detail;
    if (!d || typeof d.summary !== "string" || !d.summary) return;
    notify({
      title: d.summary,
      body: typeof d.body === "string" && d.body ? d.body : undefined,
      icon: typeof d.icon === "string" ? d.icon : undefined,
      timeoutMs: typeof d.timeoutMs === "number" && Number.isFinite(d.timeoutMs) ? d.timeoutMs : undefined,
    });
  });
}

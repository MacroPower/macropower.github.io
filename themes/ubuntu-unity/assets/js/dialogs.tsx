import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type {
  UPDialogButton,
  UPDialogIcon,
  UPDialogOptions,
} from "./types";

interface Dialog {
  id: number;
  title: string;
  body: string;
  details: string | null;
  icon: UPDialogIcon;
  buttons: UPDialogButton[];
  resolve: (value: string | null) => void;
}

type DialogListener = (list: Dialog[]) => void;

const dialogListeners = new Set<DialogListener>();
let dialogSeq = 0;
const dialogQueue: Dialog[] = [];

function emit(): void {
  dialogListeners.forEach((fn) => fn(Array.from(dialogQueue)));
}

function uiDialog(opts: UPDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const d: Dialog = {
      id: ++dialogSeq,
      title: opts.title ?? "",
      body: opts.body ?? "",
      details: opts.details ?? null,
      icon: opts.icon ?? "info",
      buttons: opts.buttons ?? [{ id: "ok", label: "Close", primary: true }],
      resolve,
    };
    dialogQueue.push(d);
    emit();
  });
}

function dismiss(id: number, value: string | null): void {
  const idx = dialogQueue.findIndex((d) => d.id === id);
  if (idx < 0) return;
  const [d] = dialogQueue.splice(idx, 1);
  d?.resolve(value);
  emit();
}

window.uiDialog = uiDialog;

interface IconColors {
  bg: string;
  ring: string;
  fg: string;
  glyph: string;
}

const ICON_COLORS: Record<Exclude<UPDialogIcon, "none">, IconColors> = {
  info:     { bg: "#3F87C9", ring: "#2A5F94", fg: "#fff",     glyph: "i" },
  question: { bg: "#7A6FB0", ring: "#564E87", fg: "#fff",     glyph: "?" },
  warning:  { bg: "#E5A93C", ring: "#A87815", fg: "#3A2A0A", glyph: "!" },
  error:    { bg: "#C7391E", ring: "#8C2410", fg: "#fff",     glyph: "✕" },
  success:  { bg: "#5C8A3A", ring: "#3F5F25", fg: "#fff",     glyph: "✓" },
};

function DialogIcon({ kind }: { kind: UPDialogIcon }): JSX.Element {
  const c = kind === "none" ? ICON_COLORS.info : ICON_COLORS[kind];
  return (
    <div style={{
      width: 48, height: 48, borderRadius: 24,
      background: `radial-gradient(circle at 35% 28%, ${c.bg} 0%, ${c.ring} 80%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: c.fg, fontSize: 30, fontWeight: 700, lineHeight: 1,
      fontFamily: "Ubuntu",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,.35), 0 1px 2px rgba(0,0,0,.25)",
      flexShrink: 0,
    }}>
      <span style={{ transform: "translateY(-1px)" }}>{c.glyph}</span>
    </div>
  );
}

interface DialogProps {
  d: Dialog;
  index: number;
  total: number;
}

function Dialog({ d, index, total }: DialogProps): JSX.Element {
  const [appear, setAppear] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const firstBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setAppear(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (index === total - 1) firstBtnRef.current?.focus();
  }, [index, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (index !== total - 1) return;
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss(d.id, null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const primary = d.buttons.find((b) => b.primary) ?? d.buttons[d.buttons.length - 1];
        if (primary) dismiss(d.id, primary.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [d, index, total]);

  const [shake, setShake] = useState(false);
  const onBackdrop = (): void => {
    if (index !== total - 1) return;
    setShake(true);
    setTimeout(() => setShake(false), 380);
  };

  const onDragStart = (e: React.MouseEvent<HTMLDivElement>): void => {
    if ((e.target as Element).closest("button")) return;
    e.preventDefault();
    setDragging(true);
    const sx = e.clientX, sy = e.clientY;
    const ox = offset.x, oy = offset.y;
    const move = (ev: MouseEvent): void => {
      setOffset({ x: ox + (ev.clientX - sx), y: oy + (ev.clientY - sy) });
    };
    const up = (): void => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <>
      <div
        onMouseDown={onBackdrop}
        style={{
          position: "absolute", inset: 0,
          background: "rgba(0,0,0,.32)",
          opacity: appear ? 1 : 0,
          transition: "opacity .15s ease",
          zIndex: 1000 + index * 2,
        }}
      />
      <div role="dialog" aria-modal="true" aria-label={d.title}
        style={{
          position: "absolute", left: "50%", top: "50%",
          ["--ox" as string]: offset.x + "px",
          ["--oy" as string]: offset.y + "px",
          transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${appear ? 1 : 0.96})`,
          width: 440, maxWidth: "calc(100% - 64px)",
          background: "#EFEDEB",
          color: "#2E2B28",
          border: "1px solid rgba(0,0,0,.6)",
          borderRadius: 6,
          boxShadow: "0 24px 80px rgba(0,0,0,.55), 0 6px 18px rgba(0,0,0,.4)",
          opacity: appear ? 1 : 0,
          transition: dragging
            ? "none"
            : "opacity .15s ease, transform .18s cubic-bezier(.2,.8,.3,1)",
          fontFamily: "Ubuntu",
          fontSize: 13.5,
          overflow: "hidden",
          zIndex: 1000 + index * 2 + 1,
          animation: shake && !dragging ? "dlgShake .38s" : "none",
        } as React.CSSProperties}>
        <div
          onMouseDown={onDragStart}
          style={{
            height: 26, padding: "0 10px 0 8px",
            background: "linear-gradient(180deg,#3F3D3A 0%,#2A2825 100%)",
            borderBottom: "1px solid rgba(0,0,0,.4)",
            display: "flex", alignItems: "center",
            cursor: dragging ? "grabbing" : "grab",
            userSelect: "none",
          }}>
          <DialogCloseBtn onClick={() => dismiss(d.id, null)} />
          <div style={{
            flex: 1, textAlign: "center",
            color: "#F4F0EC", fontSize: 12, fontWeight: 500,
            marginRight: 18,
          }}>{d.title || "Information"}</div>
        </div>

        <div style={{
          padding: "22px 22px 16px",
          display: "flex", gap: 18, alignItems: "flex-start",
        }}>
          {d.icon !== "none" && <DialogIcon kind={d.icon} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            {d.title && (
              <div style={{
                fontSize: 15, fontWeight: 500, lineHeight: 1.3,
                marginBottom: d.body ? 8 : 0, color: "#2E2B28",
              }}>{d.title}</div>
            )}
            {d.body && (
              <div style={{
                color: "#3A3733", lineHeight: 1.5, whiteSpace: "pre-wrap",
              }}>{d.body}</div>
            )}
            {d.details && (
              <pre style={{
                marginTop: 12, padding: "10px 12px",
                background: "#FBFAF9", border: "1px solid #DCD7D2",
                borderRadius: 3, fontFamily: "Ubuntu Mono",
                fontSize: 12, color: "#3A3733",
                whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto",
              }}>{d.details}</pre>
            )}
          </div>
        </div>

        <div style={{
          padding: "10px 14px 14px",
          background: "#E8E5E2",
          borderTop: "1px solid #D4D0CD",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          {d.buttons.map((b, i) => (
            <DialogBtn key={b.id} button={b}
              ref={i === d.buttons.length - 1 ? firstBtnRef : null}
              onClick={() => dismiss(d.id, b.id)} />
          ))}
        </div>
      </div>
    </>
  );
}

function DialogCloseBtn({ onClick }: { onClick: () => void }): JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label="Close"
      style={{
        width: 14, height: 14, borderRadius: 7, padding: 0,
        border: 0, cursor: "default",
        background: `radial-gradient(circle at 38% 32%, ${hover ? "#FF8060" : "#F0664A"} 0%, ${hover ? "#DC4824" : "#C7391E"} 70%, #8C2410 100%)`,
        boxShadow: "inset 0 .5px 0 rgba(255,255,255,.35), inset 0 -.5px 0 rgba(0,0,0,.55), 0 1px 1px rgba(0,0,0,.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <svg width="6" height="6" viewBox="0 0 6 6">
        <path d="M1 1 L5 5 M5 1 L1 5" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    </button>
  );
}

interface DialogBtnProps {
  button: UPDialogButton;
  onClick: () => void;
}

const DialogBtn = React.forwardRef<HTMLButtonElement, DialogBtnProps>(
  function DialogBtn({ button, onClick }, ref) {
    const [hover, setHover] = useState(false);
    const [pressed, setPressed] = useState(false);
    const primary = Boolean(button.primary);
    const danger = Boolean(button.danger);

    const bg = primary
      ? `linear-gradient(180deg, ${pressed ? "#BD3D11" : hover ? "#EC5A29" : "#DD4814"} 0%, ${pressed ? "#922F0C" : "#B23B11"} 100%)`
      : danger
        ? `linear-gradient(180deg, ${pressed ? "#8C2410" : hover ? "#FBFAF9" : "#FBFAF9"} 0%, ${pressed ? "#8C2410" : "#E5E2DF"} 100%)`
        : `linear-gradient(180deg, ${pressed ? "#D8D5D2" : hover ? "#FFFFFF" : "#FBFAF9"} 0%, ${pressed ? "#C5C1BD" : "#E5E2DF"} 100%)`;

    const color = primary ? "#fff" : danger ? "#A02B12" : "#2E2B28";
    const borderColor = primary ? "rgba(0,0,0,.35)" : "#B5AFAA";

    return (
      <button
        ref={ref}
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => { setHover(false); setPressed(false); }}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        style={{
          minWidth: 84,
          padding: "5px 14px",
          background: bg,
          color,
          border: "1px solid " + borderColor,
          borderRadius: 3,
          fontSize: 13, fontWeight: primary ? 500 : 400,
          fontFamily: "Ubuntu",
          cursor: "default",
          boxShadow: pressed
            ? "inset 0 1px 3px rgba(0,0,0,.25)"
            : primary
              ? "inset 0 1px 0 rgba(255,255,255,.25), 0 1px 1px rgba(0,0,0,.15)"
              : "inset 0 1px 0 rgba(255,255,255,.6), 0 1px 1px rgba(0,0,0,.08)",
          outline: "none",
        }}>{button.label}</button>
    );
  },
);

function DialogHost(): JSX.Element | null {
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  useEffect(() => {
    const fn: DialogListener = (list) => setDialogs(list);
    dialogListeners.add(fn);
    return () => { dialogListeners.delete(fn); };
  }, []);
  if (!dialogs.length) return null;
  return (
    <div style={{
      position: "absolute", inset: 0,
      zIndex: 1000, pointerEvents: "auto",
    }}>
      <style>{`
        @keyframes dlgShake {
          0%,100% { transform: translate(calc(-50% + var(--ox,0)), calc(-50% + var(--oy,0))) scale(1); }
          15%,55% { transform: translate(calc(-50% + var(--ox,0) - 6px), calc(-50% + var(--oy,0))) scale(1); }
          35%,75% { transform: translate(calc(-50% + var(--ox,0) + 6px), calc(-50% + var(--oy,0))) scale(1); }
        }
      `}</style>
      {dialogs.map((d, i) => (
        <Dialog key={d.id} d={d} index={i} total={dialogs.length} />
      ))}
    </div>
  );
}

export function mountDialogs(): void {
  const el = document.getElementById("up-dialog-host");
  if (!el) {
    console.warn("ubuntu-unity: #up-dialog-host not found; dialogs disabled");
    return;
  }
  createRoot(el).render(<DialogHost />);
}

export { uiDialog, DialogHost };

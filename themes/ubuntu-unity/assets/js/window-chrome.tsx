import React, { useState, ReactNode } from "react";

export interface WindowProps {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  dragging?: boolean;
  dx?: number;
  dy?: number;
  title: string;
}

type TitleBtnKind = "close" | "min" | "max";

interface WindowChromeProps {
  w: WindowProps;
  focused: boolean;
  onPointerDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onClose: () => void;
  onMin: () => void;
  onMax: () => void;
  children?: ReactNode;
}

export function WindowChrome({
  w,
  focused,
  onPointerDown,
  onClose,
  onMin,
  onMax,
  children,
}: WindowChromeProps): JSX.Element {
  const tbActive = "linear-gradient(180deg,#3F3D3A 0%,#2A2825 100%)";
  const tbIdle   = "linear-gradient(180deg,#4D4A47 0%,#3B3835 100%)";

  return (
    <div
      onMouseDown={onPointerDown}
      style={{
        position: "absolute",
        left: w.x, top: w.y,
        width: w.w, height: w.h,
        display: "flex", flexDirection: "column",
        borderRadius: 6,
        boxShadow: focused
          ? "0 0 0 1px rgba(0,0,0,.55), 0 20px 50px rgba(0,0,0,.55), 0 4px 14px rgba(0,0,0,.35)"
          : "0 0 0 1px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.4)",
        overflow: "hidden",
        opacity: w.minimized ? 0 : 1,
        transform: w.minimized
          ? `translate(${-w.x + 24}px, ${window.innerHeight - w.y + 40}px) scale(.1)`
          : (w.dx || w.dy)
            ? `translate(${w.dx ?? 0}px, ${w.dy ?? 0}px)`
            : "none",
        pointerEvents: w.minimized ? "none" : "auto",
        transition: (w.dragging || w.dx || w.dy)
          ? "none"
          : "transform .25s ease, opacity .2s ease",
        zIndex: w.z,
      }}>
      <div
        data-titlebar
        style={{
          height: 26, flexShrink: 0,
          background: focused ? tbActive : tbIdle,
          borderBottom: "1px solid rgba(0,0,0,.4)",
          display: "flex", alignItems: "center",
          paddingLeft: 6, paddingRight: 10,
          cursor: "default",
        }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginRight: 10 }}>
          <TitleBtn kind="close" focused={focused} onClick={onClose} />
          <TitleBtn kind="min"   focused={focused} onClick={onMin} />
          <TitleBtn kind="max"   focused={focused} onClick={onMax} />
        </div>
        <div style={{
          flex: 1, textAlign: "center", color: focused ? "#F4F0EC" : "#A8A29D",
          fontSize: 12, fontWeight: 500, letterSpacing: ".01em",
          textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap",
          marginRight: 60,
        }}>
          {w.title}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {children}
      </div>
    </div>
  );
}

interface TitleBtnProps {
  kind: TitleBtnKind;
  onClick: () => void;
  focused: boolean;
}

interface Palette {
  base: string;
  hover: string;
  idle: string;
}

const PALETTES: Record<TitleBtnKind, Palette> = {
  close: {
    base:  "radial-gradient(circle at 38% 32%, #F0664A 0%, #C7391E 70%, #8C2410 100%)",
    hover: "radial-gradient(circle at 38% 32%, #FF8060 0%, #DC4824 70%, #A02B12 100%)",
    idle:  "radial-gradient(circle at 38% 32%, #6E4842 0%, #4A2820 70%, #2C140F 100%)",
  },
  min: {
    base:  "radial-gradient(circle at 38% 32%, #6E6963 0%, #4A4540 70%, #2A2622 100%)",
    hover: "radial-gradient(circle at 38% 32%, #88837C 0%, #5C5750 70%, #34302C 100%)",
    idle:  "radial-gradient(circle at 38% 32%, #514D48 0%, #38342F 70%, #1F1C18 100%)",
  },
  max: {
    base:  "radial-gradient(circle at 38% 32%, #6E6963 0%, #4A4540 70%, #2A2622 100%)",
    hover: "radial-gradient(circle at 38% 32%, #88837C 0%, #5C5750 70%, #34302C 100%)",
    idle:  "radial-gradient(circle at 38% 32%, #514D48 0%, #38342F 70%, #1F1C18 100%)",
  },
};

function TitleBtn({ kind, onClick, focused }: TitleBtnProps): JSX.Element {
  const [hover, setHover] = useState(false);
  const p = PALETTES[kind];
  const bg = !focused ? p.idle : (hover ? p.hover : p.base);

  const glyph = kind === "close" ? (
    <svg width="6" height="6" viewBox="0 0 6 6">
      <path d="M1 1 L5 5 M5 1 L1 5" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ) : kind === "min" ? (
    <svg width="6" height="6" viewBox="0 0 6 6">
      <path d="M1 4.2 L5 4.2" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="6" height="6" viewBox="0 0 6 6">
      <rect x="1" y="1" width="4" height="4" fill="none" stroke="#fff" strokeWidth="1" />
    </svg>
  );

  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={kind}
      style={{
        width: 14, height: 14, borderRadius: 7, padding: 0,
        border: 0, cursor: "default",
        background: bg,
        boxShadow:
          "inset 0 .5px 0 rgba(255,255,255,.35), inset 0 -.5px 0 rgba(0,0,0,.55), 0 1px 1px rgba(0,0,0,.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
      <span style={{
        opacity: focused ? 1 : 0.55,
        display: "flex", alignItems: "center", justifyContent: "center",
        filter: "drop-shadow(0 .5px 0 rgba(0,0,0,.5))",
      }}>{glyph}</span>
    </button>
  );
}

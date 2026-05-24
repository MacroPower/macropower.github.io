import React, { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { WindowChrome } from "./window-chrome.jsx";
import { setTrashFocused, subscribe, getTrashFocused } from "./focus.js";

const TRASH_W = 480;
const TRASH_H = 340;
const CASCADE_X = 32;
const CASCADE_Y = 28;
const SIDE_OFFSET = 64;

function syncLauncherTile(open, focused) {
  const tile = document.querySelector('[data-launcher-trash]');
  if (!tile) return;
  tile.classList.toggle('is-active', !!open);
  tile.classList.toggle('is-focused', !!(open && focused));
}

function PathBar({ handle }) {
  return (
    <div className="up-pathbar">
      <span className="up-pathbar-pill">{handle || ""}</span>
      <span className="up-pathbar-sep" aria-hidden="true">›</span>
      <span className="up-pathbar-pill is-current">trash</span>
    </div>
  );
}

function TrashBody({ handle }) {
  const uiDialog = window.uiDialog || (() => Promise.resolve(null));
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--content-bg)" }}>
      <PathBar handle={handle} />
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 16,
        color: "#8A8580",
      }}>
        <svg width="68" height="76" viewBox="0 0 68 76" fill="none" stroke="#B5AFAA" strokeWidth="2">
          <path d="M10 18 h48 l-4 54 a2 2 0 0 1-2 2 h-36 a2 2 0 0 1-2-2 z" fill="#E8E3DE" />
          <rect x="4" y="12" width="60" height="6" rx="1" fill="#D4CFC8" stroke="#B5AFAA"/>
          <rect x="26" y="4" width="16" height="8" rx="1" fill="#D4CFC8" stroke="#B5AFAA"/>
          <path d="M22 28 v36 M34 28 v36 M46 28 v36"/>
        </svg>
        <div style={{ fontSize: 16, color: "#5A5550" }}>Trash is empty</div>
        <div style={{ fontSize: 12.5, maxWidth: 280, textAlign: "center", lineHeight: 1.5 }}>
          Nothing thrown away yet. Tried that essay about dotfiles three
          times — kept saving it.
        </div>
        <button onClick={() => uiDialog({
          icon: "info", title: "Trash is already empty",
          body: "There's nothing here to remove.",
        })} style={{
          marginTop: 6, padding: "6px 14px",
          background: "linear-gradient(180deg,#FBFAF9,#E5E2DF)",
          border: "1px solid #C9C5C1", borderRadius: 3,
          fontSize: 12.5, color: "#3A3733", cursor: "default",
        }}>Empty Trash</button>
      </div>
    </div>
  );
}

function Trash() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [pos, setPos] = useState({ x: SIDE_OFFSET + CASCADE_X, y: 24 + CASCADE_Y });
  const [dragging, setDragging] = useState(false);
  const focused = useSyncExternalStore(subscribe, getTrashFocused);
  const handle = (window.UP_SITE && window.UP_SITE.handle) || "";

  const stateRef = useRef({ open, minimized });
  stateRef.current = { open, minimized };

  useEffect(() => {
    syncLauncherTile(open && !minimized, focused);
  }, [open, minimized, focused]);

  useEffect(() => {
    const onTrashClick = (e) => {
      const t = e.target.closest && e.target.closest('[data-launcher="trash"]');
      if (!t) return;
      e.preventDefault();
      const { open: o, minimized: m } = stateRef.current;
      const f = getTrashFocused();
      if (!o) {
        setOpen(true);
        setMinimized(false);
        setTrashFocused(true);
        return;
      }
      if (f && !m) {
        setMinimized(true);
        setTrashFocused(false);
        return;
      }
      setMinimized(false);
      setTrashFocused(true);
    };
    window.addEventListener("click", onTrashClick);
    return () => window.removeEventListener("click", onTrashClick);
  }, []);

  if (!open) return null;

  const onPointerDown = (e) => {
    if (!(e.target instanceof Element)) return;
    if (!focused) setTrashFocused(true);
    const tb = e.target.closest("[data-titlebar]");
    if (!tb) return;
    if (e.target.closest("button")) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const ox = pos.x, oy = pos.y;
    setDragging(true);
    const move = (ev) => {
      const nx = ox + (ev.clientX - startX);
      const ny = Math.max(24, oy + (ev.clientY - startY));
      setPos({ x: nx, y: ny });
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const close = () => {
    setOpen(false);
    setTrashFocused(false);
  };
  const minimize = () => {
    setMinimized(true);
    setTrashFocused(false);
  };
  const toggleMax = () => {};

  const w = {
    x: pos.x,
    y: pos.y,
    w: TRASH_W,
    h: TRASH_H,
    z: focused ? 30 : 19,
    minimized,
    dragging,
    title: "Trash",
  };

  return (
    <WindowChrome
      w={w}
      focused={focused}
      onPointerDown={onPointerDown}
      onClose={close}
      onMin={minimize}
      onMax={toggleMax}
    >
      <TrashBody handle={handle} />
    </WindowChrome>
  );
}

export function mountTrash() {
  const host = document.getElementById("up-trash-host");
  if (!host) {
    console.warn("ubuntu-unity: #up-trash-host not found; trash disabled");
    return;
  }
  createRoot(host).render(<Trash />);
}

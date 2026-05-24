import React, { useState, useEffect, useRef, useSyncExternalStore, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { subscribe, getTrashFocused } from "./focus";
import { WINDOW_STATE_EVENT } from "./page-window";
import type { UPPageWindowState, UPSite } from "./types";

type LauncherKey = "about" | "cv" | "blog" | "contact";
type MenuKey = "file" | "edit" | "view" | "help";
type FlyoutKey = "inbox" | "net" | "vol" | "bat" | "clock" | "user";
type OpenKey = MenuKey | FlyoutKey | null;

interface MenuItemDef {
  sep?: false;
  label: string;
  sc?: string;
  check?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}
interface MenuSeparator { sep: true }
type MenuEntry = MenuItemDef | MenuSeparator;

const LAUNCHER_URLS: Record<LauncherKey, string> = {
  about: "/about/",
  cv: "/cv/",
  blog: "/posts/",
  contact: "/contact/",
};

const EMPTY_SITE: UPSite = { handle: "", github: "", rss: "" };
const getSite = (): UPSite => window.UP_SITE ?? EMPTY_SITE;

function navigate(key: LauncherKey): void {
  const url = LAUNCHER_URLS[key];
  if (url) window.location.href = url;
}

interface TopPanelProps {
  pageTitle: string;
}

function TopPanel({ pageTitle }: TopPanelProps): JSX.Element {
  const trashFocused = useSyncExternalStore(subscribe, getTrashFocused);
  const [winState, setWinState] = useState(() => {
    const snap = (typeof window !== "undefined" ? window.UP_PAGE_WINDOW_STATE : undefined) ?? null;
    return {
      visible: snap?.visible !== false,
      minimized: Boolean(snap?.minimized),
      closed: Boolean(snap?.closed),
    };
  });
  const desktopTitle = "Ubuntu";
  const focusedTitle = trashFocused
    ? "Trash"
    : (winState.visible ? pageTitle : desktopTitle);
  const [now, setNow] = useState(() => new Date());
  const [openMenu, setOpenMenu] = useState<OpenKey>(null);
  const [vol, setVol] = useState(62);
  const [muted, setMuted] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const h = (e: Event): void => {
      const detail = (e as CustomEvent<UPPageWindowState>).detail;
      setWinState({
        visible: Boolean(detail.visible),
        minimized: Boolean(detail.minimized),
        closed: Boolean(detail.closed),
      });
    };
    window.addEventListener(WINDOW_STATE_EVENT, h);
    return () => window.removeEventListener(WINDOW_STATE_EVENT, h);
  }, []);

  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 560,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 560px)");
    const h = (e: MediaQueryListEvent | MediaQueryList): void => setNarrow(e.matches);
    h(mq);
    mq.addEventListener("change", h);
    return () => { mq.removeEventListener("change", h); };
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent): void => {
      const target = e.target as Element | null;
      if (target?.closest("[data-panel-trigger]")) return;
      if (target?.closest("[data-flyout-keepopen]")) return;
      setOpenMenu(null);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("click", handler);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("click", handler);
      window.removeEventListener("keydown", esc);
    };
  }, [openMenu]);

  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const date = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const longDate = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const toggle = (k: OpenKey): void => setOpenMenu((cur) => cur === k ? null : k);

  const uiDialog = window.uiDialog ?? (() => Promise.resolve<string | null>(null));
  const site = getSite();

  const MENUS: Record<MenuKey, MenuEntry[]> = {
    file: [
      { label: "Open about",   onClick: () => navigate("about") },
      { label: "Open blog",    onClick: () => navigate("blog") },
      { label: "Open CV",      onClick: () => navigate("cv") },
      { label: "Open contact", onClick: () => navigate("contact") },
      { sep: true },
      { label: "Close window", sc: "Ctrl+W", disabled: true },
    ],
    edit: [
      { label: "Undo", sc: "Ctrl+Z", disabled: true },
      { label: "Redo", sc: "Ctrl+Y", disabled: true },
      { sep: true },
      { label: "Cut",   sc: "Ctrl+X", disabled: true },
      { label: "Copy",  sc: "Ctrl+C", disabled: true },
      { label: "Paste", sc: "Ctrl+V", disabled: true },
      { sep: true },
      { label: "Preferences…", onClick: () => void uiDialog({
        icon: "info",
        title: "Preferences",
        body: "This site doesn't ship a settings panel.",
      }) },
    ],
    view: [
      { label: "Reload", sc: "Ctrl+R", onClick: () => window.location.reload() },
      { label: "Toggle full window", onClick: () => void document.documentElement.requestFullscreen?.().catch(() => {}) },
      { sep: true },
      { label: "Show launcher", check: true, onClick: () => void uiDialog({
        icon: "info",
        title: "Launcher is always shown",
        body: "The launcher is part of the shell.",
      }) },
      { label: "Show top panel", check: true, onClick: () => {} },
    ],
    help: [
      { label: "About this site", onClick: () => navigate("about") },
      { label: "Keyboard shortcuts", onClick: () => void uiDialog({
        icon: "info",
        title: "Keyboard shortcuts",
        body: "A few shortcuts work across the desktop:",
        details: "Ctrl+W       close the focused window\nEsc           dismiss menus and dialogs\nDrag titlebar to reposition any window or dialog.",
      }) },
      { sep: true },
      { label: "Get in touch", onClick: () => navigate("contact") },
      { label: "View source on github", onClick: () => void uiDialog({
        icon: "info",
        title: "Source",
        body: site.github
          ? "This is a personal site living at " + site.github + "."
          : "This is a personal site.",
        buttons: [{ id: "ok", label: "OK", primary: true }],
      }) },
    ],
  };

  return (
    <div ref={wrapRef} style={{
      position: "absolute", top: 0, left: 0, right: 0, height: 24,
      background:
        "linear-gradient(180deg, rgba(63,61,58,.96) 0%, rgba(37,36,35,.96) 100%)",
      borderBottom: "1px solid rgba(0,0,0,.5)",
      display: "flex", alignItems: "center",
      color: "#E8E5E2", fontSize: 12, zIndex: 50,
      backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
    }}>
      <div data-panel-trigger style={{
        display: "inline-flex", alignItems: "center",
        height: 24, padding: "0 12px 0 8px",
        flex: "0 0 auto", minWidth: 0,
        maxWidth: "min(40vw, 280px)",
        color: "#fff", fontWeight: 700, userSelect: "none",
      }}>
        <span style={{
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{focusedTitle}</span>
      </div>
      {!narrow && (["file", "edit", "view", "help"] as MenuKey[]).map((m) => (
        <PanelItem key={m} open={openMenu === m} onClick={() => toggle(m)}>
          {m[0]!.toUpperCase() + m.slice(1)}
          {openMenu === m && (
            <Dropdown align="left">
              <MenuList items={MENUS[m]} onClose={() => setOpenMenu(null)} />
            </Dropdown>
          )}
        </PanelItem>
      ))}

      <div style={{ flex: 1 }} />

      {!narrow && <PanelItem open={openMenu === "inbox"} onClick={() => toggle("inbox")}>
        <Glyph kind="env" />
        {openMenu === "inbox" && (
          <Dropdown align="right" stayOpen>
            <DropHeader>Messages</DropHeader>
            <DropBody>
              <div style={{ color: "rgba(255,255,255,.6)", fontSize: 12 }}>No new messages.</div>
              <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                <DropBtn onClick={() => { setOpenMenu(null); navigate("contact"); }}>Compose</DropBtn>
                <DropBtn ghost onClick={() => { setOpenMenu(null); void uiDialog({
                  icon: "success", title: "Subscribed",
                  body: site.rss
                    ? "Pretend-subscribed to " + site.rss + ". Drop the URL into your reader of choice."
                    : "Pretend-subscribed. Drop the feed URL into your reader of choice.",
                }); }}>Subscribe to feed</DropBtn>
              </div>
            </DropBody>
          </Dropdown>
        )}
      </PanelItem>}

      {!narrow && <PanelItem open={openMenu === "net"} onClick={() => toggle("net")}>
        <Glyph kind="net" />
        {openMenu === "net" && (
          <Dropdown align="right" stayOpen>
            <DropHeader>Network</DropHeader>
            <DropBody>
              <NetRow name="café-do-bairro" strong on />
              <NetRow name="MEO-WiFi" />
              <NetRow name="ngrok-tunnel" mono />
              <NetRow name="(hidden)" muted />
              <div style={{ borderTop: "1px solid rgba(255,255,255,.1)", margin: "6px 0" }} />
              <DropRow onClick={() => { setOpenMenu(null); void uiDialog({
                icon: "warning", title: "No wired connection",
                body: "No ethernet cable detected. Plug one in to use a wired network.",
              }); }}>Wired connection</DropRow>
              <DropRow onClick={() => { setOpenMenu(null); void uiDialog({
                icon: "question", title: "Enable Wi-Fi hotspot?",
                body: "Other devices will be able to share this connection. Estimated battery cost: significant.",
                buttons: [
                  { id: "cancel", label: "Cancel" },
                  { id: "on", label: "Enable hotspot", primary: true },
                ],
              }); }}>Enable hotspot</DropRow>
            </DropBody>
          </Dropdown>
        )}
      </PanelItem>}

      <PanelItem open={openMenu === "vol"} onClick={() => toggle("vol")}>
        <Glyph kind="vol" muted={muted} />
        {openMenu === "vol" && (
          <Dropdown align="right" stayOpen>
            <DropHeader>Sound</DropHeader>
            <DropBody>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={() => setMuted(!muted)} style={{
                  width: 24, height: 24, padding: 0, border: 0,
                  background: "transparent", color: "#fff", cursor: "default",
                }}>
                  <Glyph kind="vol" muted={muted} />
                </button>
                <input type="range" min={0} max={100} value={muted ? 0 : vol}
                  onChange={(e) => { setVol(Number(e.target.value)); setMuted(false); }}
                  style={{ flex: 1, accentColor: "#DD4814" }} />
                <span style={{ width: 28, textAlign: "right", color: "rgba(255,255,255,.7)", fontSize: 11 }}>
                  {muted ? "—" : vol}
                </span>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "rgba(255,255,255,.5)" }}>
                Output: <span style={{ color: "rgba(255,255,255,.85)" }}>Built-in audio</span>
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: "rgba(255,255,255,.55)" }}>
                ♪ Now playing: <i>Caetano Veloso — Transa, A1</i>
              </div>
            </DropBody>
          </Dropdown>
        )}
      </PanelItem>

      {!narrow && <PanelItem open={openMenu === "bat"} onClick={() => toggle("bat")}>
        <Glyph kind="bat" />
        {openMenu === "bat" && (
          <Dropdown align="right" stayOpen>
            <DropHeader>Battery</DropHeader>
            <DropBody>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,.9)" }}>76% — discharging</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)", marginTop: 2 }}>
                About 3 hours 14 minutes remaining
              </div>
              <div style={{ height: 8, background: "rgba(255,255,255,.12)", borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
                <div style={{ width: "76%", height: "100%", background: "linear-gradient(90deg,#DD4814,#E95420)" }} />
              </div>
              <DropRow onClick={() => { setOpenMenu(null); void uiDialog({
                icon: "success", title: "Power saver enabled",
                body: "Screen will dim after 1 minute. Background tasks throttled.",
              }); }}>Enable power saver</DropRow>
              <DropRow onClick={() => { setOpenMenu(null); void uiDialog({
                icon: "info", title: "Power settings",
                body: "The System Settings panel isn't wired up in this build. The raw data lives in /sys/class/power_supply/BAT0/uevent.",
              }); }}>Power settings…</DropRow>
            </DropBody>
          </Dropdown>
        )}
      </PanelItem>}

      <PanelItem strong open={openMenu === "clock"} onClick={() => toggle("clock")}>
        {narrow ? time : `${date}  ${time}`}
        {openMenu === "clock" && (
          <Dropdown align="right" wide stayOpen>
            <DropHeader>{longDate}</DropHeader>
            <DropBody>
              <MiniCalendar now={now} />
              <DropRow onClick={() => { setOpenMenu(null); void uiDialog({
                icon: "info", title: "Calendar",
                body: "No events today. The next thing on the calendar is a haircut next Tuesday.",
              }); }}>Open calendar</DropRow>
              <DropRow onClick={() => { setOpenMenu(null); void uiDialog({
                icon: "info", title: "Time & date",
                body: "Time zone: Europe/Lisbon (WEST, UTC+1). Synced via NTP.",
              }); }}>Time settings…</DropRow>
            </DropBody>
          </Dropdown>
        )}
      </PanelItem>

      <PanelItem open={openMenu === "user"} onClick={() => toggle("user")}>
        <Glyph kind="user" />
        {openMenu === "user" && (
          <Dropdown align="right" stayOpen>
            <DropHeader>{site.handle}</DropHeader>
            <DropBody>
              <DropRow onClick={() => { setOpenMenu(null); navigate("about"); }}>About me</DropRow>
              <DropRow onClick={() => { setOpenMenu(null); navigate("contact"); }}>Get in touch</DropRow>
              <div style={{ borderTop: "1px solid rgba(255,255,255,.1)", margin: "6px 0" }} />
              <DropRow onClick={() => { setOpenMenu(null); void uiDialog({
                icon: "info", title: "Lock screen",
                body: "Just kidding — there's nothing to lock. This is a website.",
              }); }}>Lock screen</DropRow>
              <DropRow onClick={() => window.location.reload()}>Restart session</DropRow>
              <DropRow danger onClick={async () => {
                setOpenMenu(null);
                const r = await uiDialog({
                  icon: "question", title: "Log out of " + (site.handle || "user") + "?",
                  body: "All unsaved windows will be closed. You can sign back in by reloading the page.",
                  buttons: [
                    { id: "cancel", label: "Cancel" },
                    { id: "out", label: "Log out", primary: true, danger: true },
                  ],
                });
                if (r === "out") window.location.reload();
              }}>Log out…</DropRow>
            </DropBody>
          </Dropdown>
        )}
      </PanelItem>
    </div>
  );
}

interface PanelItemProps {
  children?: ReactNode;
  onClick?: () => void;
  open?: boolean;
  strong?: boolean;
  padded?: boolean;
}

function PanelItem({ children, onClick, open, strong, padded }: PanelItemProps): JSX.Element {
  const [hover, setHover] = useState(false);
  const interactive = Boolean(onClick);
  const arr = React.Children.toArray(children);
  const triggerKids: ReactNode[] = [];
  const dropdownKids: ReactNode[] = [];
  arr.forEach((c) => {
    if (React.isValidElement(c) && c.type === Dropdown) {
      dropdownKids.push(c);
    } else {
      triggerKids.push(c);
    }
  });
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", height: 24 }}>
      <div
        data-panel-trigger
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          height: 24, padding: padded ? "0 12px 0 14px" : "0 8px",
          background: open ? "rgba(255,255,255,.16)" : hover && interactive ? "rgba(255,255,255,.08)" : "transparent",
          color: strong ? "#fff" : "rgba(255,255,255,.82)",
          cursor: "default",
          fontVariantNumeric: "tabular-nums",
          fontWeight: strong ? 700 : 400,
          userSelect: "none",
        }}>
        {triggerKids}
      </div>
      {dropdownKids}
    </div>
  );
}

interface DropdownProps {
  align: "left" | "right";
  wide?: boolean;
  stayOpen?: boolean;
  children?: ReactNode;
}

function Dropdown({ align, wide, stayOpen, children }: DropdownProps): JSX.Element {
  const stickyAttr: Record<string, string> = stayOpen ? { "data-flyout-keepopen": "" } : {};
  return (
    <div {...stickyAttr} style={{
      position: "absolute", top: 24,
      [align === "right" ? "right" : "left"]: 0,
      minWidth: wide ? 280 : 220, maxWidth: 320,
      background: "linear-gradient(180deg, rgba(38,36,33,.98) 0%, rgba(28,26,24,.98) 100%)",
      border: "1px solid rgba(0,0,0,.6)",
      boxShadow: "0 12px 32px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06)",
      borderRadius: "0 0 4px 4px",
      color: "#E8E5E2",
      fontSize: 12.5,
      zIndex: 200,
      padding: 0,
      overflow: "hidden",
    }}>
      {children}
    </div>
  );
}

function DropHeader({ children }: { children?: ReactNode }): JSX.Element {
  return (
    <div style={{
      padding: "8px 12px", fontSize: 11, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: ".08em",
      color: "rgba(255,255,255,.55)",
      borderBottom: "1px solid rgba(255,255,255,.08)",
    }}>{children}</div>
  );
}

function DropBody({ children }: { children?: ReactNode }): JSX.Element {
  return <div style={{ padding: "6px 0" }}>{children}</div>;
}

interface DropRowProps {
  children?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}

function DropRow({ children, onClick, danger }: DropRowProps): JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "5px 14px",
        background: hover ? (danger ? "rgba(221,72,20,.5)" : "rgba(221,72,20,.65)") : "transparent",
        color: hover ? "#fff" : (danger ? "#F0B0A0" : "rgba(255,255,255,.86)"),
        cursor: "default",
      }}>{children}</div>
  );
}

interface DropBtnProps {
  children?: ReactNode;
  onClick?: () => void;
  ghost?: boolean;
}

function DropBtn({ children, onClick, ghost }: DropBtnProps): JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} style={{
      padding: "5px 10px", border: 0, borderRadius: 3,
      background: ghost
        ? (hover ? "rgba(255,255,255,.1)" : "transparent")
        : (hover ? "var(--orange-light)" : "var(--orange)"),
      color: "#fff", fontSize: 12, fontFamily: "Ubuntu", cursor: "default",
    }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>{children}</button>
  );
}

interface NetRowProps {
  name: string;
  on?: boolean;
  strong?: boolean;
  mono?: boolean;
  muted?: boolean;
}

function NetRow({ name, on, strong, mono, muted }: NetRowProps): JSX.Element {
  const uiDialog = window.uiDialog ?? (() => Promise.resolve<string | null>(null));
  return (
    <DropRow onClick={() => {
      void (async () => {
        if (on) {
          await uiDialog({ icon: "info", title: "Already connected", body: "You're connected to " + name + "." });
          return;
        }
        const r = await uiDialog({
          icon: "question", title: "Connect to " + name + "?",
          body: "This will disconnect you from café-do-bairro. Continue?",
          buttons: [
            { id: "cancel", label: "Cancel" },
            { id: "connect", label: "Connect", primary: true },
          ],
        });
        if (r === "connect") {
          await uiDialog({
            icon: "warning", title: "Couldn't connect",
            body: "Authentication failed for " + name + ". Check the password and try again.",
          });
        }
      })();
    }}>
      <span style={{
        display: "inline-block", width: 14,
        color: on ? "var(--orange-light)" : "rgba(255,255,255,.4)",
      }}>{on ? "●" : "○"}</span>
      <span style={{
        color: muted ? "rgba(255,255,255,.4)" : "inherit",
        fontFamily: mono ? "Ubuntu Mono" : "inherit",
        fontWeight: strong ? 600 : 400,
      }}>{name}</span>
    </DropRow>
  );
}

interface MenuListProps {
  items: MenuEntry[];
  onClose?: () => void;
}

function MenuList({ items, onClose }: MenuListProps): JSX.Element {
  return (
    <div style={{ padding: "4px 0" }}>
      {items.map((it, i) => it.sep ? (
        <div key={i} style={{ height: 1, background: "rgba(255,255,255,.08)", margin: "4px 0" }} />
      ) : (
        <MenuItem key={i} {...it} onClose={onClose} />
      ))}
    </div>
  );
}

interface MenuItemProps extends MenuItemDef {
  onClose?: () => void;
}

function MenuItem({ label, sc, check, disabled, onClick, onClose }: MenuItemProps): JSX.Element {
  const [hover, setHover] = useState(false);
  const enabled = !disabled;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => { if (enabled) { onClick?.(); onClose?.(); } }}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "4px 14px 4px 26px",
        position: "relative",
        background: enabled && hover ? "var(--orange-light)" : "transparent",
        color: enabled ? (hover ? "#fff" : "rgba(255,255,255,.92)") : "rgba(255,255,255,.35)",
        cursor: "default",
      }}>
      {check && (
        <span style={{ position: "absolute", left: 12, color: "rgba(255,255,255,.6)" }}>✓</span>
      )}
      <span style={{ flex: 1 }}>{label}</span>
      {sc && <span style={{ fontSize: 11, color: hover && enabled ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.4)" }}>{sc}</span>}
    </div>
  );
}

function MiniCalendar({ now }: { now: Date }): JSX.Element {
  const y = now.getFullYear(), m = now.getMonth();
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const today = now.getDate();
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2,
        fontSize: 10, color: "rgba(255,255,255,.45)", textAlign: "center", marginBottom: 4,
      }}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map((c, i) => (
          <div key={i} style={{
            aspectRatio: "1.4",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, color: c == null ? "transparent" : "rgba(255,255,255,.85)",
            background: c === today ? "var(--orange-light)" : "transparent",
            borderRadius: 2, fontWeight: c === today ? 600 : 400,
          }}>{c ?? "·"}</div>
        ))}
      </div>
    </div>
  );
}

type GlyphKind = "env" | "net" | "vol" | "bat" | "user";

function Glyph({ kind, muted }: { kind: GlyphKind; muted?: boolean }): JSX.Element | null {
  if (kind === "env") return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="1" y="3" width="12" height="8" rx="1"/>
      <path d="M1.5 3.5 L7 8 L12.5 3.5"/>
    </svg>
  );
  if (kind === "net") return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="2" y="9" width="2.5" height="3"/>
      <rect x="5.5" y="6" width="2.5" height="6"/>
      <rect x="9" y="3" width="2.5" height="9"/>
    </svg>
  );
  if (kind === "vol") return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="currentColor">
      <path d="M2 5 h2 l3-3 v10 l-3-3 h-2 z"/>
      {!muted && <path d="M9 4 q2 3 0 6" stroke="currentColor" strokeWidth="1.2" fill="none"/>}
      {!muted && <path d="M11 2 q4 5 0 10" stroke="currentColor" strokeWidth="1.2" fill="none"/>}
      {muted && <path d="M9 4 L14 10 M14 4 L9 10" stroke="currentColor" strokeWidth="1.2"/>}
    </svg>
  );
  if (kind === "bat") return (
    <svg width="22" height="14" viewBox="0 0 22 14" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="1" y="3" width="17" height="8" rx="1"/>
      <rect x="18.5" y="5" width="1.5" height="4" fill="currentColor" stroke="none"/>
      <rect x="2.5" y="4.5" width="11" height="5" fill="currentColor" stroke="none"/>
    </svg>
  );
  if (kind === "user") return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <circle cx="7" cy="5" r="2.5"/>
      <path d="M2 12 c0-2.5 2.2-4.5 5-4.5 s5 2 5 4.5"/>
    </svg>
  );
  return null;
}

export function mountTopPanel(): void {
  const root = document.getElementById("root");
  if (!root) {
    console.warn("ubuntu-unity: #root not found; top panel not mounted");
    return;
  }
  const host = document.createElement("div");
  host.id = "up-top-panel-host";
  root.insertBefore(host, root.firstChild);
  const titleFromSSR = document.querySelector<HTMLElement>(".up-top-panel[data-ssr] .up-panel-title");
  const pageTitle = (titleFromSSR?.textContent ?? document.title ?? "").trim();
  createRoot(host).render(<TopPanel pageTitle={pageTitle} />);
}

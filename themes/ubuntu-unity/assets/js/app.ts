import { initDialogs } from "./dialogs";
import { initNotify } from "./notify";
import { initTopPanel } from "./top-panel";
import { initTrash } from "./trash";
import { initDaw } from "./daw";
import { initDash } from "./dash";
import { initHud } from "./hud";
import { installPageWindow } from "./page-window";
import { initDesktopMarquee } from "./desktop-marquee";
import { initLock } from "./lock";
import { setReduceMotion } from "./prefs";

// Seed reduce-motion from the OS preference so JS-timed animations
// (window fly-out, tile removal, lock fade) skip their waits too; the
// CSS media query already covers pure style animations. The Preferences
// switch reads the body class, so it reflects the seeded state.
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  setReduceMotion(true);
}

initDialogs();
// Before initTopPanel so its bubbles are available the moment the volume
// slider (or any other panel control) first fires one.
initNotify();
// Before initTopPanel so the lock overlay's window keydown listener is
// registered first and can stopImmediatePropagation past the dropdown-close
// handler when Esc unlocks.
initLock();
initTopPanel();
initTrash();
initDaw();
initDash();
initHud();
installPageWindow();
initDesktopMarquee();
document.body.classList.add("up-ready");

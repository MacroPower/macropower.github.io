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
import { emitDocument, READY_EVENT } from "./events";

// Seed reduce-motion from the OS preference so JS-timed animations
// (window fly-out, tile removal, lock fade) skip their waits too; the
// CSS media query already covers pure style animations. The Preferences
// switch reads the body class, so it reflects the seeded state.
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  setReduceMotion(true);
}

// Runs one module's init. A module that throws, on markup a site
// customized for example, logs and leaves the rest of the desktop working.
function run(name: string, init: () => void): void {
  try {
    init();
  } catch (err) {
    console.error(`unity: ${name} failed to start`, err);
  }
}

run("dialogs", initDialogs);
// Before initTopPanel so its bubbles are available the moment the volume
// slider (or any other panel control) first fires one.
run("notify", initNotify);
// Before initTopPanel so the lock overlay's window keydown listener is
// registered first and can stopImmediatePropagation past the dropdown-close
// handler when Esc unlocks.
run("lock", initLock);
run("top panel", initTopPanel);
run("trash", initTrash);
run("studio", initDaw);
run("dash", initDash);
run("hud", initHud);
run("page window", installPageWindow);
run("desktop marquee", initDesktopMarquee);
document.body.classList.add("up-ready");
// A site's own scripts (extend-footer.html) run before this deferred
// bundle, so they wait for this event to call window.uiDialog and the
// other desktop APIs.
emitDocument(READY_EVENT, null);

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
import { followSystemMotion } from "./prefs";
import { emitDocument, READY_CLASS, READY_EVENT } from "./events";

// Runs one module's init. A module that throws, on markup a site
// customized for example, logs and leaves the rest of the desktop working.
function run(name: string, init: () => void): void {
  try {
    init();
  } catch (err) {
    console.error(`unity: ${name} failed to start`, err);
  }
}

// First, so the body class holds the visitor's system setting before any
// module, or any page bundle that loads after this one, checks it.
run("reduce motion", followSystemMotion);
run("dialogs", initDialogs);
// Before initTopPanel so its bubbles are available the moment the volume
// slider (or any other panel control) first fires one.
run("notify", initNotify);
// Before initTopPanel, so the lock overlay registers its window keydown
// listener first and can stopImmediatePropagation past the dropdown-close
// handler when Esc unlocks.
run("lock", initLock);
run("top panel", initTopPanel);
run("trash", initTrash);
// UP_STUDIO is false on a site without MIDI files, and esbuild then drops
// the Studio's code from this bundle.
if (UP_STUDIO) run("studio", initDaw);
run("dash", initDash);
run("hud", initHud);
run("page window", installPageWindow);
run("desktop marquee", initDesktopMarquee);
document.body.classList.add(READY_CLASS);
// A site's script that runs before this deferred bundle, such as a
// classic script in either hook partial, waits for this event. A deferred
// or module script in extend-footer.html runs after this event, so it
// checks READY_CLASS first. README.md documents the rule.
emitDocument(READY_EVENT, null);

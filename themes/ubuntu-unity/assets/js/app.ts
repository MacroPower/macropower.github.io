import { initDialogs } from "./dialogs";
import { initTopPanel } from "./top-panel";
import { initTrash } from "./trash";
import { initDaw } from "./daw";
import { installPageWindow } from "./page-window";
import { initLock } from "./lock";

initDialogs();
// Before initTopPanel so the lock overlay's window keydown listener is
// registered first and can stopImmediatePropagation past the dropdown-close
// handler when Esc unlocks.
initLock();
initTopPanel();
initTrash();
initDaw();
installPageWindow();
document.body.classList.add("up-ready");

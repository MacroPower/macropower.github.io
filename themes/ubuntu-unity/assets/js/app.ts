import { initDialogs } from "./dialogs";
import { initTopPanel } from "./top-panel";
import { initTrash } from "./trash";
import { installPageWindow } from "./page-window";
import { initPrefs } from "./prefs";

initDialogs();
initPrefs();
initTopPanel();
initTrash();
installPageWindow();
document.body.classList.add("up-ready");

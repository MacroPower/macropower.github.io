import { initDialogs } from "./dialogs";
import { mountTopPanel } from "./top-panel";
import { initTrash } from "./trash";
import { installPageWindow } from "./page-window";

if (!window.React || !window.ReactDOM) {
  console.warn("ubuntu-unity: React/ReactDOM not loaded; interactive layer disabled");
} else {
  initDialogs();
  mountTopPanel();
  initTrash();
  installPageWindow();
  document.body.classList.add("up-react-ready");
}

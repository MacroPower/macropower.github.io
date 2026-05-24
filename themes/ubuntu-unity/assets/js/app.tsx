import { mountDialogs } from "./dialogs";
import { mountTopPanel } from "./top-panel";
import { mountTrash } from "./trash";
import { installPageWindow } from "./page-window";

if (!window.React || !window.ReactDOM) {
  console.warn("ubuntu-unity: React/ReactDOM not loaded; interactive layer disabled");
} else {
  mountDialogs();
  mountTopPanel();
  mountTrash();
  installPageWindow();
  document.body.classList.add("up-react-ready");
}

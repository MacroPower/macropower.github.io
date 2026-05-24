import { mountDialogs } from "./dialogs.jsx";
import { mountTopPanel } from "./top-panel.jsx";
import { mountTrash } from "./trash.jsx";
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

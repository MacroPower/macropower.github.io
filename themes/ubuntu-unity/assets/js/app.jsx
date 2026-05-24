import { mountDialogs } from "./dialogs.jsx";
import { mountTopPanel } from "./top-panel.jsx";
import { mountTrash } from "./trash.jsx";
import { installPageRubberBand } from "./rubber-band.js";

if (!window.React || !window.ReactDOM) {
  console.warn("ubuntu-unity: React/ReactDOM not loaded; interactive layer disabled");
} else {
  mountDialogs();
  mountTopPanel();
  mountTrash();
  installPageRubberBand();
  document.body.classList.add("up-react-ready");
}

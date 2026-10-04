import "./ui/app.css";
import "./ui/theme.css";
import { initializeTheme } from "./theme";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RecorderWidget } from "./ui/RecorderWidget";

if (window.location.hash === "#recorder") document.documentElement.classList.add("recorder-window");

initializeTheme();

const el = document.getElementById("root");
if (el !== null) {
  createRoot(el).render(window.location.hash === "#recorder" ? <RecorderWidget /> : <App />);
}

import { createRoot } from "react-dom/client";
import { restoreTheme } from "../../../shared/components/ThemeSwitch/ThemeSwitch";
import { Pill } from "./Pill";
import "./pill.css";

// The Settings preview passes its theme; the native window follows the saved preference.
const requestedTheme = new URLSearchParams(window.location.search).get("theme");
if (requestedTheme === "dark" || requestedTheme === "light")
  document.documentElement.dataset.theme = requestedTheme;
else restoreTheme();

createRoot(document.getElementById("root")!).render(<Pill />);

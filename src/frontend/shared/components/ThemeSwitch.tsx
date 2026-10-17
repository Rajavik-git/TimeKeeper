import { useState } from "react";
import { Icon } from "./Icon";

type Theme = "auto" | "light" | "dark";
const key = "timekeepr-theme";
function savedTheme(): Theme {
  const value = localStorage.getItem(key);
  return value === "light" || value === "dark" ? value : "auto";
}
function applyTheme(theme: Theme) {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  return (
    <div className="theme" role="group" aria-label="Theme">
      {(["light", "dark", "auto"] as const).map((value) => (
        <button
          key={value}
          aria-pressed={theme === value}
          onClick={() => {
            setTheme(value);
            localStorage.setItem(key, value);
            applyTheme(value);
          }}
        >
          <Icon
            name={
              value === "light" ? "sun" : value === "dark" ? "moon" : "auto"
            }
            small
          />
          {value[0].toUpperCase() + value.slice(1)}
        </button>
      ))}
    </div>
  );
}
export function restoreTheme() {
  applyTheme(savedTheme());
}

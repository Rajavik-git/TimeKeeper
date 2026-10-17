const DESIGN_WIDTH = 1400;
const DESIGN_HEIGHT = 950;
const MIN_ZOOM = 0.62;

/** Fit the desktop layout while retaining the responsive layout below 900px. */
export function fitViewport(): void {
  const apply = () => {
    const root = document.documentElement;
    if (window.innerWidth < 900) {
      root.style.removeProperty("zoom");
      root.style.removeProperty("--fit-zoom");
      return;
    }

    const scale = Math.min(
      1,
      Math.max(
        MIN_ZOOM,
        Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT),
      ),
    );
    const zoom = String(Math.round(scale * 1000) / 1000);
    root.style.setProperty("zoom", zoom);
    root.style.setProperty("--fit-zoom", zoom);
  };

  apply();
  window.addEventListener("resize", apply);
}

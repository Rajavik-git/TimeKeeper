// Scales the whole interface so the landscape layout designed for 1280x800 fits any desktop
// window without scrolling: windows smaller than the design zoom out; larger ones keep the normal size.
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 800;
const MIN_ZOOM = 0.72;
const MAX_ZOOM = 1;

export function fitViewport(): void {
  const apply = () => {
    const root = document.documentElement;
    // Phones and narrow windows keep the responsive single-column layout.
    if (window.innerWidth < 900) {
      root.style.removeProperty("zoom");
      root.style.removeProperty("--fit-zoom");
      return;
    }
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT)));
    root.style.setProperty("zoom", String(Math.round(zoom * 1000) / 1000));
    root.style.setProperty("--fit-zoom", String(zoom));
  };
  apply();
  window.addEventListener("resize", apply);
}

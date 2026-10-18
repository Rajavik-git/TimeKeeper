import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
export const tauri = "__TAURI_INTERNALS__" in window;
type PillPlacement = {
  anchorX: number;
  anchorY: number;
  above: boolean;
  width: number;
  height: number;
  barHeight: number;
};
type BrowserPosition = { x: number; y: number };

const positionKey = "timekeeper:pill-position";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Position and pause preferences are conveniences; the pill works without storage.
  }
}
function savedPosition(): BrowserPosition {
  try {
    const value = JSON.parse(readStorage(positionKey) ?? "null");
    return value && Number.isFinite(value.x) && Number.isFinite(value.y)
      ? { x: value.x, y: value.y }
      : { x: 0, y: 0 };
  } catch {
    return { x: 0, y: 0 };
  }
}

export function usePillPosition({
  alwaysOnTop,
  expanded,
  recent,
  notification,
  error,
  setError,
}: {
  alwaysOnTop?: boolean;
  expanded: boolean;
  recent: unknown;
  notification: boolean;
  error: string;
  setError: (message: string) => void;
}) {
  const [browserPosition, setBrowserPosition] = useState<BrowserPosition>(savedPosition);
  const [above, setAbove] = useState(false);
  const [popupHeight, setPopupHeight] = useState(0);
  const [placementVersion, setPlacementVersion] = useState(0);
  const placementRequestRevision = useRef(0);
  const nativePlacement = useRef<PillPlacement | null>(null);
  const ignoreNativeMoveUntil = useRef(0);
  const dragStart = useRef<{ x: number; y: number; origin: BrowserPosition } | null>(null);
  if (tauri && !nativePlacement.current && readStorage(positionKey)) {
    const saved = savedPosition();
    nativePlacement.current = {
      anchorX: saved.x,
      anchorY: saved.y,
      above: false,
      width: 0,
      height: 0,
      barHeight: 38,
    };
  }
  useEffect(() => {
    if (tauri && alwaysOnTop !== undefined)
      void getCurrentWindow()
        .setAlwaysOnTop(alwaysOnTop)
        .catch(() => setError("Unable to set pill position."));
  }, [alwaysOnTop, setError]);
  useEffect(() => {
    if (!tauri) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    let timer = 0;
    void getCurrentWindow()
      .onMoved(({ payload }) => {
        if (Date.now() < ignoreNativeMoveUntil.current) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          const placement = nativePlacement.current;
          if (!placement || !placement.width) return;
          const next = {
            ...placement,
            anchorX: payload.x + placement.width / 2,
            anchorY: payload.y + (placement.above ? placement.height - placement.barHeight : 0),
          };
          nativePlacement.current = next;
          writeStorage(positionKey, JSON.stringify({ x: next.anchorX, y: next.anchorY }));
          setPlacementVersion((value) => value + 1);
        }, 220);
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      });
    return () => {
      cancelled = true;
      stop?.();
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>(".pill-bar");
    const content = [
      ...document.querySelectorAll<HTMLElement>(".pill-panel,.pill-notice,.pill-error"),
    ];
    let frame = 0;
    const resize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const popup = content.find((element) => element.matches(".pill-panel,.pill-notice"));
        const popupSize = popup?.offsetHeight ?? 0;
        setPopupHeight(popupSize);
        const contentWidth = Math.ceil(
          Math.max(bar?.offsetWidth ?? 0, ...content.map((element) => element.offsetWidth)),
        );
        const contentHeight = Math.ceil(
          Math.max(bar?.offsetHeight ?? 0, ...content.map((element) => 46 + element.offsetHeight)),
        );
        if (tauri) {
          const anchor = nativePlacement.current;
          ignoreNativeMoveUntil.current = Date.now() + 400;
          const requestRevision = ++placementRequestRevision.current;
          void invoke<PillPlacement>("set_pill_expanded", {
            expanded,
            notification,
            contentWidth,
            contentHeight,
            // Rust expects whole pixels; an odd pill width makes the dragged centre fractional.
            anchorX: anchor ? Math.round(anchor.anchorX) : null,
            anchorY: anchor ? Math.round(anchor.anchorY) : null,
          })
            .then((position) => {
              if (requestRevision !== placementRequestRevision.current) return;
              nativePlacement.current = position;
              setAbove(position.above);
              writeStorage(
                positionKey,
                JSON.stringify({ x: position.anchorX, y: position.anchorY }),
              );
            })
            .catch(() => {
              if (requestRevision === placementRequestRevision.current)
                setError("Unable to resize the pill.");
            });
        } else
          setAbove(
            !!popup &&
              browserPosition.y + 46 + popupSize > window.innerHeight &&
              browserPosition.y >= popupSize + 8,
          );
      });
    };
    const observer = new ResizeObserver(resize);
    if (bar) observer.observe(bar);
    content.forEach((element) => observer.observe(element));
    resize();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      placementRequestRevision.current += 1;
    };
  }, [
    expanded,
    recent,
    notification,
    error,
    placementVersion,
    browserPosition.x,
    browserPosition.y,
    setError,
  ]);
  const clampBrowser = (value: BrowserPosition): BrowserPosition => {
    const margin = Math.max(0, (window.innerWidth - 360) / 2);
    let y = Math.max(0, Math.min(window.innerHeight - 38, value.y));
    if (popupHeight) {
      const belowMax = window.innerHeight - 46 - popupHeight;
      const aboveMin = popupHeight + 8;
      if (y > belowMax && y < aboveMin)
        y =
          y - belowMax < aboveMin - y
            ? Math.max(0, belowMax)
            : Math.min(window.innerHeight - 38, aboveMin);
    }
    return { x: Math.max(-margin, Math.min(margin, value.x)), y };
  };
  const moveBy = (dx: number, dy: number, reset = false) => {
    if (tauri) {
      if (reset) {
        nativePlacement.current = null;
        writeStorage(positionKey, null);
      } else if (nativePlacement.current)
        nativePlacement.current = {
          ...nativePlacement.current,
          anchorX: nativePlacement.current.anchorX + dx,
          anchorY: nativePlacement.current.anchorY + dy,
        };
      setPlacementVersion((value) => value + 1);
    } else {
      const next = reset
        ? { x: 0, y: 0 }
        : clampBrowser({ x: browserPosition.x + dx, y: browserPosition.y + dy });
      setBrowserPosition(next);
      writeStorage(positionKey, JSON.stringify(next));
    }
  };
  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (tauri) {
      void getCurrentWindow()
        .startDragging()
        .catch(() => setError("Unable to move the pill."));
      return;
    }
    dragStart.current = { x: event.clientX, y: event.clientY, origin: browserPosition };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = dragStart.current;
    if (!start) return;
    setBrowserPosition(
      clampBrowser({
        x: start.origin.x + event.clientX - start.x,
        y: start.origin.y + event.clientY - start.y,
      }),
    );
  };
  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const next = clampBrowser({
      x: start.origin.x + event.clientX - start.x,
      y: start.origin.y + event.clientY - start.y,
    });
    setBrowserPosition(next);
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    writeStorage(positionKey, JSON.stringify(next));
  };
  const dragKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!event.altKey) return;
    const delta =
      event.key === "ArrowLeft"
        ? [-20, 0]
        : event.key === "ArrowRight"
          ? [20, 0]
          : event.key === "ArrowUp"
            ? [0, -20]
            : event.key === "ArrowDown"
              ? [0, 20]
              : null;
    if (event.key === "Home") {
      event.preventDefault();
      moveBy(0, 0, true);
    } else if (delta) {
      event.preventDefault();
      moveBy(delta[0], delta[1]);
    }
  };
  const rootStyle = (tauri
    ? { "--pill-popup-height": `${popupHeight}px` }
    : {
        transform: `translate(${browserPosition.x}px,${browserPosition.y}px)`,
        "--pill-popup-height": `${popupHeight}px`,
      }) as unknown as CSSProperties;

  return { above, rootStyle, beginDrag, dragMove, endDrag, dragKey, moveBy };
}

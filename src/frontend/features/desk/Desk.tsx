import { calendarTime } from "../../../shared/dates";
import { useEffect, useState, type CSSProperties } from "react";
import { type ScreenProps } from "../../api/client";
import { Card } from "../../shared/components/Card/Card";
import { nativePillView } from "./lib/nativePillView";
import { useToday } from "../../shared/hooks/useToday";

/** The preview embeds the same pill page as the desktop window. */
const previewFrame: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  border: 0,
  zIndex: 5,
};

export function Desk({
  catalogState,
  workspaceState,
  navigate,
}: Pick<ScreenProps, "catalogState" | "workspaceState" | "navigate">) {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? "auto");
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setTheme(document.documentElement.dataset.theme ?? "auto"),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  const view = nativePillView(catalogState, workspaceState, useToday(), null);
  const session = view.active;
  const period = view.current;
  return (
    <>
      <div className="row between">
        <div>
          <span className="eyebrow">
            <button className="link" onClick={() => navigate("settings")}>
              Settings
            </button>{" "}
            › Desk pill preview
          </span>
          <h1>Desk pill preview</h1>
        </div>
        <span className="small muted">Session and period state come from the application API.</span>
      </div>
      <div className="desk">
        <div className="docwin">
          <div className="row between dochead">
            <span>{period?.observedWindowTitle ?? period?.label ?? "No active period"}</span>
            <span className="num">{session ? calendarTime(session.startedAt) : "—"}</span>
          </div>
          <div className="docpage">
            <h2>No document preview</h2>
            <p>Document content is not available in this preview.</p>
          </div>
        </div>
        <iframe
          title="Interactive desk pill preview"
          src={`/pill.html?theme=${theme}`}
          style={previewFrame}
        />
      </div>
      <Card>
        <span className="small muted">
          The pill shows accepted work periods. Closing the desktop window leaves the session
          active. Screenpipe commands start and end it.
        </span>
      </Card>
    </>
  );
}

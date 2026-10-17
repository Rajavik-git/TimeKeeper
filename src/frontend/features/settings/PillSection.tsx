import type { components } from "../../../contracts/generated";
import { api } from "../../api/client";
import { cardHead, type SectionProps } from "./shared";

export function PillSection({ catalogState, action, saved, navigate }: SectionProps) {
  const patchSetting = (body: components["schemas"]["PatchCatalogSettingsRequest"]) =>
    saved(
      action(
        api.PATCH("/api/catalog/settings", {
          body,
        }),
      ),
    );
  return (
    <>
      <section className="settings-card">
        {cardHead(
          "Desk pill",
          "The small bar at the top centre of your screen, above every application.",
        )}
        <div className="settings-form">
          <label htmlFor="pill-top">Show the pill</label>
          <label className="check">
            <input
              type="checkbox"
              id="pill-top"
              checked={catalogState.settings.pillAlwaysOnTop}
              onChange={(event) => patchSetting({ pillAlwaysOnTop: event.target.checked })}
            />{" "}
            Always on top of other windows
          </label>
          <label htmlFor="pill-display">Show</label>
          <select
            className="select"
            id="pill-display"
            value={catalogState.settings.pillDisplay}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "fees" || value === "time" || value === "case")
                void patchSetting({ pillDisplay: value });
            }}
          >
            <option value="fees">Fees earned on the current case</option>
            <option value="time">Time on the current case</option>
            <option value="case">Current case only</option>
          </select>
          <label htmlFor="pill-notifications">Notifications</label>
          <label className="check">
            <input
              type="checkbox"
              id="pill-notifications"
              checked={catalogState.settings.notifications}
              onChange={(event) => patchSetting({ notifications: event.target.checked })}
            />{" "}
            Tell me when a period needs my answer
          </label>
          <label htmlFor="pill-calls">During calls</label>
          <label className="check">
            <input
              type="checkbox"
              id="pill-calls"
              checked={catalogState.settings.pillWithholdCalls}
              onChange={(event) =>
                patchSetting({
                  pillWithholdCalls: event.target.checked,
                })
              }
            />{" "}
            Hold notifications until the call ends
          </label>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-preview">
          <div>
            <b>See how it looks</b>
            <p>A preview of the pill on a sample desktop.</p>
          </div>
          <button className="btn" onClick={() => navigate("desk")}>
            Open preview
          </button>
        </div>
      </section>
    </>
  );
}

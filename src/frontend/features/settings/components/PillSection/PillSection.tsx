import { pillDisplayLabels } from "../../../../shared/presentation/catalog";
import { PillDisplay } from "../../../../../contracts/states.generated";
import type { components } from "../../../../../contracts/generated";
import { api } from "../../../../api/client";
import { cardHead } from "../../lib/sectionPresentation";
import { type SectionProps } from "../../types";

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
      <section className="card settings-card">
        {cardHead(
          "Desk pill",
          "In the desktop app, the pill sits at the top center of your screen.",
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
          <label htmlFor="pill-display">Show for this period</label>
          <select
            className="select"
            id="pill-display"
            value={catalogState.settings.pillDisplay}
            onChange={(event) => {
              const pillDisplay = Object.values(PillDisplay).find(
                (value) => value === event.target.value,
              );
              if (pillDisplay !== undefined) void patchSetting({ pillDisplay });
            }}
          >
            {Object.entries(pillDisplayLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
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
          <label htmlFor="pill-calls">Call-related labels</label>
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
            Hold notifications while the work label suggests a call
          </label>
        </div>
      </section>
      <section className="card settings-card">
        <div className="settings-preview">
          <div>
            <b>See how it looks</b>
            <p>Preview the pill with your current session.</p>
          </div>
          <button className="btn" onClick={() => navigate("desk")}>
            Open preview
          </button>
        </div>
      </section>
    </>
  );
}

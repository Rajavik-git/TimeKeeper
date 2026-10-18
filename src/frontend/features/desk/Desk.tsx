import { AssignmentOrigin } from "../../../contracts/states.generated";
import { calendarTime } from "../../../shared/dates";
import { useState } from "react";
import { api, type ScreenProps } from "../../api/client";
import { Card } from "../../shared/components/Card/Card";
import { WorkPill } from "./components/WorkPill/WorkPill";
import { pillView } from "./lib/pillView";

export function Desk({ catalogState, workspaceState, action, navigate }: ScreenProps) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const view = pillView(catalogState, workspaceState);
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
            <span>{period?.demoWindowTitle ?? period?.label ?? "No active period"}</span>
            <span className="num">{session ? calendarTime(session.startedAt) : "—"}</span>
          </div>
          <div className="docpage">
            <h2>No document preview</h2>
            <p>Document content is not available in this preview.</p>
          </div>
        </div>
        <div className="desk-pill-preview">
          <WorkPill
            view={view}
            expanded={open}
            onToggle={() => setOpen(!open)}
            notice={dismissed ? null : view.notice}
            onDismiss={() => setDismissed(true)}
            onOpenDay={() => navigate("myDay")}
            onAssign={(caseId) => {
              if (period)
                void action(
                  api.POST("/api/work-periods/{id}/assignment", {
                    params: { path: { id: period.id } },
                    body: {
                      caseId,
                      expectedAssignmentRevision: period.assignmentRevision,
                      origin: AssignmentOrigin.Lawyer,
                    },
                  }),
                );
            }}
          />
        </div>
      </div>
      <Card>
        <span className="small muted">
          Closing the desktop window leaves the session active. Screenpipe commands start and end
          it.
        </span>
      </Card>
    </>
  );
}

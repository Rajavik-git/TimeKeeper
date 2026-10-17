import { calendarTime } from "../../../shared/dates";
import { useToday } from "../../shared/hooks/useToday";
import { useState } from "react";
import {
  api,
  clientForCase,
  caseById,
  money as formatMoney,
  type ScreenProps,
} from "../../api/client";
import {
  configuredRate,
  effectiveMs,
  formatPreciseDuration,
  formatRoundedMinutes,
  summarizeWork,
} from "../../calculations/billing";
import { Card } from "../../shared/components/Card";
import { CaseSelect } from "../../shared/components/CaseSelect";
import { Kpi } from "../../shared/components/Kpi";
import { CaseReference } from "../../shared/components/CaseReference";
import { Logo } from "../../shared/brand/Logo";

export function Desk({ catalogState, workspaceState, action, navigate }: ScreenProps) {
  const today = useToday();
  const money = (cents: number) => formatMoney(cents, catalogState.settings.currency ?? "USD");

  const [open, setOpen] = useState(false);
  const session = workspaceState.activeSession;
  const period = workspaceState.periods.find(
    (p) => p.sessionId === session?.id && p.endedAt === null,
  );
  const caseId = period?.caseId ?? null;
  const activeCase = caseById(catalogState, caseId);
  const owner = clientForCase(catalogState, caseId);
  const duration = period ? formatPreciseDuration(effectiveMs(period)) : "Unknown";
  const day = workspaceState.periods.filter((p) => p.startedAt.startsWith(today) && !p.excluded);
  const dayDuration = summarizeWork(day, workspaceState.sources);
  const rate = caseId ? configuredRate(catalogState, caseId) : null;
  const currentAmount =
    period && rate && rate.origin !== "flat_fee" && effectiveMs(period) !== null
      ? Math.round((effectiveMs(period)! * rate.rateCents) / 3600000)
      : null;
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
        <button className="pastille" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="mini-logo">
            <Logo compact wordmark={false} />
          </span>
          <span className="dot" />
          <span>{owner?.name ?? "No case"}</span>
          <span className="num">{duration}</span>
        </button>
        {open && (
          <div className="float glass pad col">
            <div className="row between">
              <b>
                <CaseReference value={activeCase?.reference ?? ""} />{" "}
                {activeCase?.title ?? "Case answer needed"}
              </b>
              <span className="tiny muted">
                {session ? `Session since ${calendarTime(session.startedAt)}` : "No active session"}
              </span>
            </div>
            <span className="small muted">
              {period
                ? `This period since ${calendarTime(period.startedAt)}`
                : "Waiting for a period"}{" "}
              · {duration}
            </span>
            <div className="grid2">
              <Kpi
                title="This period"
                value={currentAmount === null ? "—" : money(currentAmount)}
              />
              <Kpi
                title="Today"
                value={formatRoundedMinutes(dayDuration.roundedMinutes)}
                detail={
                  dayDuration.complete
                    ? "After corrections"
                    : "Partial total · some durations or sources are unavailable"
                }
                dark
              />
            </div>
            {period && (
              <label className="col">
                Other case{" "}
                <CaseSelect
                  catalogState={catalogState}
                  value={caseId}
                  onChange={(value) => {
                    if (value)
                      void action(
                        api.POST("/api/work-periods/{id}/assignment", {
                          params: { path: { id: period.id } },
                          body: {
                            caseId: String(value),
                            expectedAssignmentRevision: period.assignmentRevision,
                            origin: "lawyer",
                          },
                        }),
                      );
                  }}
                />
              </label>
            )}
            <button className="btn primary" onClick={() => navigate("myDay")}>
              Open my day
            </button>
          </div>
        )}
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

import { useEffect, useState } from "react";
import {
  api,
  client,
  matter,
  originLabel,
  money,
  label,
  price,
  today,
  type ScreenProps,
} from "../../api/client";
import { Card } from "../../shared/components/Card";
import { MatterSelect } from "../../shared/components/MatterSelect";
import { Kpi } from "../../shared/components/Kpi";
import { MatterReference } from "../../shared/components/MatterReference";
export function Desk({ s, action, navigate }: ScreenProps) {
  const [ticks, setTicks] = useState(0),
    [open, setOpen] = useState(false),
    [paused, setPaused] = useState(false),
    [pauseId, setPauseId] = useState<number | null>(null);
  const l =
    s.time_entry.find((x) => x.block_id === 14) ??
    s.time_entry.find((x) =>
      s.block.some((b) => b.id === x.block_id && b.state === "in_progress"),
    );
  if (!l) return <Card>No active block.</Card>;
  const b = s.block.find((x) => x.id === l.block_id)!;
  const p = price(s, l.id);
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setTicks((x) => x + 1), 1500);
    return () => clearInterval(timer);
  }, [paused]);
  const extra = p.flat_fee ? 0 : Math.round((ticks * p.rate_cents) / 60);
  const current = l.amount_cents + extra;
  const day =
    s.time_entry
      .filter((x) => x.date === today && x.id !== l.id)
      .reduce((n, x) => n + x.amount_cents, 0) + current;
  const stamp = () => new Date().toTimeString().slice(0, 5);
  const toggle = async () => {
    if (paused && pauseId) {
      await action(
        api.PATCH("/api/pauses/{id}", {
          params: { path: { id: pauseId } },
          body: { end_time: stamp() },
        }),
      );
      setPaused(false);
    } else {
      const result = await action(
        api.POST("/api/pauses", {
          body: { date: today, start_time: stamp(), reason: "" },
        }),
      );
      if (result) {
        setPauseId(result.id);
        setPaused(true);
      }
    }
  };
  return (
    <>
      <div className="row between">
        <div>
          <span className="eyebrow">Lawyer desk · live simulation</span>
          <h1>The TimeKeepr pill</h1>
        </div>
        <span className="small muted">
          The counter advances one simulated minute every 1.5 seconds.
        </span>
      </div>
      <div className="desk">
        <div className="docwin">
          <div className="row between dochead">
            <span>{b.window_title}</span>
            <span className="num">{b.end_time}</span>
          </div>
          <div className="docpage">
            <h2>{l.label}</h2>
            <p>{s.source.find((x) => x.block_id === b.id)?.excerpt}</p>
          </div>
        </div>
        <button
          className="pastille"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="mini-logo">T</span>
          <span className="dot" />
          <span>{client(s, l.matter_id)?.name ?? "?"}</span>
          <span className="num">{paused ? "pause" : `+${money(current)}`}</span>
        </button>
        {open && (
          <div className="float glass pad col">
            <div className="row between">
              <b>
                <MatterReference
                  value={matter(s, l.matter_id)?.reference ?? ""}
                />{" "}
                {matter(s, l.matter_id)?.title}
              </b>
              <span className="tiny muted">
                confidence {Math.round(b.confidence * 100)} %
              </span>
            </div>
            <span className="small muted">
              Client : {client(s, l.matter_id)?.name} · {originLabel(p.origin)}
            </span>
            <div className="grid2">
              <Kpi title="This block" value={money(current)} />
              <Kpi title="Today" value={money(day)} dark />
            </div>
            <div className="row">
              <button className="btn small" onClick={toggle}>
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                className="btn small"
                onClick={async () => {
                  if (ticks < 1) return;
                  await action(
                    api.POST("/api/blocks/{id}/close", {
                      params: { path: { id: b.id } },
                      body: { minutes: ticks },
                    }),
                  );
                  setTicks(0);
                }}
              >
                Close block
              </button>
            </div>
            <label className="col">
              Other case{" "}
              <MatterSelect
                s={s}
                value={l.matter_id}
                onChange={(v) =>
                  v &&
                  action(
                    api.PATCH("/api/time-entries/{id}", {
                      params: { path: { id: l.id } },
                      body: { matter_id: v },
                    }),
                  )
                }
              />
            </label>
            <button className="btn primary" onClick={() => navigate("myDay")}>
              Open my day
            </button>
          </div>
        )}
      </div>
      <Card>
        <span className="small muted">
          Pill actions update the database and leave an audit trail.
        </span>
      </Card>
    </>
  );
}

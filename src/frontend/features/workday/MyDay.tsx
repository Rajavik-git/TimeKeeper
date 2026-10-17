import { useEffect, useState } from "react";
import {
  api,
  client,
  shortDate,
  matter,
  money,
  hours,
  price,
  originLabel,
  task,
  today,
  type TimeEntry,
  type ScreenProps,
  type Recognition,
} from "../../api/client";
import { MatterSelect } from "../../shared/components/MatterSelect";
import { Kpi } from "../../shared/components/Kpi";
import { Status } from "../../shared/components/Status";
import { MatterReference } from "../../shared/components/MatterReference";
import { Icon } from "../../shared/components/Icon";

export function MyDay({ s, action, source }: ScreenProps) {
  const [editing, setEditing] = useState<number | null>(null);
  const [menuRow, setMenuRow] = useState<number | null>(null);
  const [manual, setManual] = useState(false);
  const [filter, setFilter] = useState<"all" | "review" | "approved" | "left">(
    "all",
  );
  const [suggestions, setSuggestions] = useState<Record<number, Recognition>>(
    {},
  );
  const unassigned = s.time_entry
    .filter(
      (entry) => entry.date === today && !entry.matter_id && entry.block_id,
    )
    .map((entry) => entry.block_id!);
  useEffect(() => {
    let active = true;
    Promise.all(
      unassigned.map(async (blockId) => ({
        blockId,
        result: (
          await api.GET("/api/blocks/{id}/recognition", {
            params: { path: { id: blockId } },
          })
        ).data,
      })),
    ).then((rows) => {
      if (active)
        setSuggestions(
          Object.fromEntries(
            rows
              .filter((row) => row.result)
              .map((row) => [row.blockId, row.result!]),
          ),
        );
    });
    return () => {
      active = false;
    };
  }, [unassigned.join(",")]);
  const lines = s.time_entry
    .filter((l) => l.date === today)
    .sort((a, b) => {
      const x = s.block.find((v) => v.id === a.block_id)?.start_time ?? "99";
      const y = s.block.find((v) => v.id === b.block_id)?.start_time ?? "99";
      return x.localeCompare(y);
    });
  const excluded = s.block.filter(
    (b) => b.date === today && b.state === "discarded",
  );
  const review = lines.filter((l) => l.review_status !== "approved");
  const approved = lines.filter((l) => l.review_status === "approved");
  const visible =
    filter === "review" ? review : filter === "approved" ? approved : lines;
  const validate = (id: number) =>
    action(
      api.PATCH("/api/time-entries/{id}", {
        params: { path: { id } },
        body: { review_status: "approved" },
      }),
    );
  const tabs = [
    ["all", "All", lines.length],
    ["review", "To review", review.length],
    ["approved", "Approved", approved.length],
    ["left", "Left out", excluded.length],
  ] as const;
  return (
    <>
      <div className="ph">
        <div className="t">
          <h1>My day</h1>
          <p>
            {new Intl.DateTimeFormat("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            }).format(new Date(today + "T12:00:00Z"))}
            . Everything below was captured by screenpipe and is waiting for
            your approval.
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setManual(true)}>
            <Icon name="plus" small />
            Off-screen time
          </button>
          <button
            className="btn primary"
            onClick={() =>
              action(api.POST("/api/day/approve", { body: { date: today } }))
            }
          >
            <Icon name="check" small />
            Approve day
          </button>
        </div>
      </div>
      <div className="grid4">
        <Kpi
          title="Fees today"
          value={money(lines.reduce((n, l) => n + l.amount_cents, 0))}
          detail="Excl. VAT"
        />
        <Kpi
          title="Time captured"
          value={hours(lines.reduce((n, l) => n + l.tenths_of_hour, 0))}
          detail={`${lines.length} entries`}
        />
        <Kpi
          title="Left out"
          value={`${excluded.reduce((n, b) => n + b.minutes, 0)} min`}
          detail={`${excluded.length} blocks, not counted`}
        />
        <Kpi
          title="To review"
          value={review.length}
          detail="Nothing is billed without you"
        />
      </div>
      <section className="card">
        <div className="toolbar">
          <div className="seg" role="group" aria-label="Time entries filter">
            {tabs.map(([value, text, count]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {text}
                <span className="c">{count}</span>
              </button>
            ))}
          </div>
        </div>
        {filter === "left" ? (
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Application</th>
                  <th>Window</th>
                  <th className="r">Duration</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {excluded.map((b) => (
                  <tr key={b.id}>
                    <td className="num">
                      {b.start_time}–{b.end_time}
                    </td>
                    <td>{b.app}</td>
                    <td className="muted">{b.window_title}</td>
                    <td className="r num">{b.minutes} min</td>
                    <td>
                      <div className="rowact">
                        <button
                          className="btn sm"
                          onClick={() =>
                            action(
                              api.POST("/api/blocks/{id}/recover", {
                                params: { path: { id: b.id } },
                              }),
                            )
                          }
                        >
                          Count as work
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!excluded.length && (
              <div className="empty">
                <span className="ic">
                  <Icon name="check" />
                </span>
                <b>No blocks left out</b>
                <span>Discarded time appears here.</span>
              </div>
            )}
          </div>
        ) : !visible.length ? (
          <div className="empty">
            <span className="ic">
              <Icon name="check" />
            </span>
            <b>Nothing waiting</b>
            <span>Every entry of the day is approved.</span>
          </div>
        ) : (
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Client</th>
                  <th>Work performed</th>
                  <th className="r">Hours</th>
                  <th className="r">Amount</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => {
                  const b = s.block.find((b) => b.id === l.block_id),
                    p = price(s, l.id),
                    d = matter(s, l.matter_id),
                    c = client(s, l.matter_id),
                    candidate = b
                      ? suggestions[b.id]?.candidates[0]
                      : undefined,
                    suggestion = candidate
                      ? matter(s, candidate.matter_id)
                      : undefined;
                  return (
                    <tr key={l.id}>
                      <td className="num">
                        {b ? `${b.start_time}–${b.end_time}` : "—"}
                        <span className="sub">
                          {b?.app ?? "Off-screen"}
                          {b && !d
                            ? ` · ${Math.round(b.confidence * 100)} %`
                            : ""}
                        </span>
                      </td>
                      <td>
                        {d ? (
                          <>
                            {c?.name}
                            <span className="sub">
                              {d.title} ·{" "}
                              <MatterReference value={d.reference} />
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="flag">
                              <Icon name="alert" small />
                              No case
                            </span>
                            {suggestion ? (
                              <span className="sub suggest">
                                Suggested: {suggestion.title} ·{" "}
                                {Math.round(candidate!.score * 100)}%{" "}
                                <button
                                  className="link"
                                  onClick={() =>
                                    action(
                                      api.PATCH("/api/time-entries/{id}", {
                                        params: { path: { id: l.id } },
                                        body: { matter_id: suggestion.id },
                                      }),
                                    )
                                  }
                                >
                                  Assign
                                </button>
                              </span>
                            ) : (
                              <span className="sub">
                                No marker found on screen
                              </span>
                            )}
                            <MatterSelect
                              s={s}
                              value={null}
                              allowEmpty
                              onChange={(v) =>
                                action(
                                  api.PATCH("/api/time-entries/{id}", {
                                    params: { path: { id: l.id } },
                                    body: { matter_id: v },
                                  }),
                                )
                              }
                            />
                          </>
                        )}
                      </td>
                      <td className="wrap">
                        {editing === l.id ? (
                          <EditLabel
                            l={l}
                            save={async (value) => {
                              await action(
                                api.PATCH("/api/time-entries/{id}", {
                                  params: { path: { id: l.id } },
                                  body: { label: value },
                                }),
                              );
                              setEditing(null);
                            }}
                            cancel={() => setEditing(null)}
                          />
                        ) : (
                          l.label
                        )}
                        <span className="sub">
                          {task(s, l.task_id)} ·{" "}
                          {p.flat_fee
                            ? "flat fee"
                            : `${originLabel(p.origin)} ${money(p.rate_cents)}/h`}
                        </span>
                      </td>
                      <td className="r num">{hours(l.tenths_of_hour)}</td>
                      <td className="r num">
                        {p.flat_fee ? (
                          <span className="muted">Flat fee</span>
                        ) : (
                          money(l.amount_cents)
                        )}
                      </td>
                      <td>
                        <Status
                          review_status={l.review_status}
                          billing_status={l.billing_status}
                          billable={l.billable}
                          reason={l.reason}
                        />
                      </td>
                      <td>
                        <div className="rowact">
                          {l.review_status !== "approved" && d && (
                            <button
                              className="iconbtn"
                              aria-label="Approve"
                              title="Approve"
                              onClick={() => validate(l.id)}
                            >
                              <Icon name="check" />
                            </button>
                          )}
                          {b && (
                            <button
                              className="iconbtn"
                              aria-label="View source"
                              title="View source"
                              onClick={() => source(l.id)}
                            >
                              <Icon name="eye" />
                            </button>
                          )}
                          <button
                            className="iconbtn"
                            aria-label="More actions"
                            title="More actions"
                            aria-expanded={menuRow === l.id}
                            onClick={() =>
                              setMenuRow(menuRow === l.id ? null : l.id)
                            }
                          >
                            <Icon name="more" />
                          </button>
                        </div>
                        {menuRow === l.id && (
                          <div className="row-menu">
                            <button
                              className="btn sm"
                              onClick={() => {
                                setEditing(l.id);
                                setMenuRow(null);
                              }}
                            >
                              Edit label
                            </button>
                            <select
                              className="field"
                              aria-label="Time entry billing"
                              value={l.billable ? "" : (l.reason ?? "offered")}
                              onChange={(e) =>
                                action(
                                  api.PATCH("/api/time-entries/{id}", {
                                    params: { path: { id: l.id } },
                                    body: {
                                      billable: !e.target.value,
                                      reason: (e.target.value || null) as
                                        "offered" | "internal" | "admin" | null,
                                    },
                                  }),
                                )
                              }
                            >
                              <option value="">Billable</option>
                              <option value="offered">Offered</option>
                              <option value="internal">Internal</option>
                              <option value="admin">Administrative</option>
                            </select>
                            {b && l.billing_status !== "billed" && (
                              <button
                                className="btn sm"
                                onClick={() =>
                                  action(
                                    api.POST("/api/time-entries/{id}/discard", {
                                      params: { path: { id: l.id } },
                                    }),
                                  )
                                }
                              >
                                Discard
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {manual && (
        <Manual
          s={s}
          close={() => setManual(false)}
          submit={async (body) => {
            await action(api.POST("/api/time-entries/manual", { body }));
            setManual(false);
          }}
        />
      )}
    </>
  );
}
function EditLabel({
  l,
  save,
  cancel,
}: {
  l: TimeEntry;
  save: (v: string) => void;
  cancel: () => void;
}) {
  const [v, setV] = useState(l.label);
  return (
    <div className="row grow">
      <input
        className="field grow"
        aria-label="Label"
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button className="btn small primary" onClick={() => save(v)}>
        Save
      </button>
      <button className="btn small" onClick={cancel}>
        Cancel
      </button>
    </div>
  );
}
function Manual({
  s,
  submit,
  close,
}: {
  s: ScreenProps["s"];
  submit: (body: {
    matter_id: number;
    task_id: number;
    date: string;
    tenths_of_hour: number;
    label: string;
  }) => void;
  close: () => void;
}) {
  const [d, setD] = useState(s.matter[0]?.id ?? 1),
    [t, setT] = useState(
      s.task.find((x) => x.off_screen)?.id ?? s.task[0]?.id ?? 0,
    ),
    [h, setH] = useState(10),
    [lib, setLib] = useState("Case management hearing");
  return (
    <div className="modal-back">
      <form
        className="modal glass pad col"
        onSubmit={(e) => {
          e.preventDefault();
          submit({
            matter_id: d,
            task_id: t,
            date: today,
            tenths_of_hour: h,
            label: lib,
          });
        }}
      >
        <h2>Add off-screen time</h2>
        <p>Hearing, meeting, travel: work the screen does not see.</p>
        <label>
          Matter <MatterSelect s={s} value={d} onChange={(v) => setD(v ?? d)} />
        </label>
        <label>
          Task{" "}
          <select
            className="field"
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
          >
            {s.task
              .filter((x) => x.off_screen)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
          </select>
        </label>
        <label>
          Duration{" "}
          <select
            className="field"
            value={h}
            onChange={(e) => setH(Number(e.target.value))}
          >
            {[3, 5, 10, 15, 20, 30].map((x) => (
              <option key={x} value={x}>
                {hours(x)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Label{" "}
          <input
            className="field"
            value={lib}
            onChange={(e) => setLib(e.target.value)}
          />
        </label>
        <div className="row">
          <button className="btn primary">Add</button>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

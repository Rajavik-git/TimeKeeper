import { geometryClass } from "../../shared/geometry";
import { useEffect, useState } from "react";
import {
  api,
  shortDate,
  label,
  type Recognition,
  type ScreenProps,
} from "../../api/client";
import { Card } from "../../shared/components/Card";
import { MatterSelect } from "../../shared/components/MatterSelect";
import { Pill } from "../../shared/components/Pill";
import { effectiveMs, formatPreciseDuration } from '../../calculations/billing';
function highlight(text: string, marker: string) {
  if (!marker) return text;
  return text.split(marker).map((part, index) => (
    <span key={index}>
      {index > 0 && <mark>{marker}</mark>}
      {part}
    </span>
  ));
}

export function Source({
  s,
  core,
  selected,
  action,
}: ScreenProps & { selected: string }) {
  const available = s.time_entry.filter((l) => l.block_id),
    [picked, setPicked] = useState<number | null>(null),
    [frame, setFrame] = useState(0),
    [recognition, setRecognition] = useState<Recognition | null>(null),
    [preview, setPreview] = useState<{
      blockId: number;
      marker: string;
      x: number;
      y: number;
      time: string;
      ref: string;
      excerpt: string;
      audio: boolean;
      progress: number;
    } | null>(null),
    [options, setOptions] = useState(["o1", "o2", "o3", "o4"]);
  const l = picked !== null ? available.find(x=>x.id===picked) :
    selected ? available.find(x=>String(x.id)===selected) : available[0];
  useEffect(() => {
    if (!l?.block_id) return;
    let active = true;
    api
      .GET("/api/blocks/{id}/recognition", {
        params: { path: { id: l.block_id } },
      })
      .then(({ data }) => {
        if (active) setRecognition(data ?? null);
      });
    return () => {
      active = false;
    };
  }, [l?.block_id]);
  if (!l) {
    const period=core.periods.find(p=>p.id===selected);
    const records=core.sources.filter(record=>record.workPeriodId===period?.id);
    return <div className="stack"><h1>Source</h1><Card>
      {period ? <><h2>{period.label}</h2><p>{formatPreciseDuration(effectiveMs(period))} · {period.timeValidated?'Time validated':'Time to validate'} · {period.billingStatus}</p>
        {records.length ? records.map(record=><div className="row between line-row" key={record.id}>
          <span>{record.recordedAt} · {record.contentType} · {record.externalId}</span>
          <span>{record.availabilityStatus}</span>
          <label className="row small"><input type="checkbox" checked={record.validationStatus==='validated'} disabled={record.validationStatus==='validated'}
            onChange={()=>void action(api.POST('/api/sources/{instanceId}/{contentType}/{externalId}/validate',{
              params:{path:{instanceId:record.instanceId,contentType:record.contentType,externalId:record.externalId}},body:{},
            }))}/>Source validated</label>
        </div>) : <p>No source linked to this period.</p>}</>
        : <p>Select a period to inspect its sources.</p>}
    </Card></div>;
  }
  const b = s.block.find((x) => x.id === l.block_id)!;
  const sources = s.source.filter((x) => x.block_id === b.id),
    f = sources[Math.min(frame, sources.length - 1)],
    audit = s.audit_event.filter(
      (x) => x.time_entry_id === l.id || x.block_id === b.id,
    ),
    jev = s.jev_review.filter((x) => x.block_id === b.id);
  const period=core.periods.find(p=>p.id===String(l.id));
  const showPreview = (
    event: React.MouseEvent<HTMLButtonElement>,
    block: typeof b,
  ) => {
    const box = event.currentTarget.getBoundingClientRect();
    const progress = Math.min(
      1,
      Math.max(0, (event.clientX - box.left) / box.width),
    );
    const start =
      Number(block.start_time.slice(0, 2)) * 3600 +
      Number(block.start_time.slice(3)) * 60;
    const second = start + Math.round(progress * block.minutes * 60);
    const time = [
      Math.floor(second / 3600),
      Math.floor((second % 3600) / 60),
      second % 60,
    ]
      .map((x) => String(x).padStart(2, "0"))
      .join(":");
    const captures = s.source
      .filter((x) => x.block_id === block.id)
      .sort((a, z) => a.timestamp.localeCompare(z.timestamp));
    const capture =
      captures.filter((x) => x.timestamp <= time.slice(0, 5)).at(-1) ??
      captures[0];
    const firstFrame = captures.find((x) =>
      x.screenpipe_ref.startsWith("frame_id "),
    );
    const frameStart = firstFrame
      ? Number(firstFrame.timestamp.slice(0, 2)) * 3600 +
        Number(firstFrame.timestamp.slice(3)) * 60
      : start;
    const baseFrame = firstFrame
      ? Number(firstFrame.screenpipe_ref.replace(/\D/g, "")) -
        Math.floor((frameStart - start) / 2)
      : 40000 + block.id * 97;
    const ref =
      capture?.type === "audio"
        ? capture.screenpipe_ref
        : `frame_id ${baseFrame + Math.floor((second - start) / 2)}`;
    setPreview({
      blockId: block.id,
      marker: capture?.detected_marker ?? "",
      x: Math.max(8, Math.min(window.innerWidth - 328, event.clientX - 160)),
      y: Math.max(8, event.clientY - 240),
      time,
      ref,
      excerpt: capture?.excerpt ?? block.window_title,
      audio: capture?.type === "audio",
      progress,
    });
  };
  const byDate = available.reduce<Record<string, typeof available>>(
    (out, x) => {
      (out[x.date] ??= []).push(x);
      return out;
    },
    {},
  );
  return (
    <>
      <div className="ph">
        <div className="t">
          <h1>Source</h1>
          <p>
            Where each billed minute comes from. Use it to answer a client or a
            fee dispute.
          </p>
        </div>
        <div className="actions">
          <button
            className="btn"
            onClick={() =>
              document
                .getElementById("source-pack")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            Source pack
          </button>
        </div>
      </div>
      <Card>
        <div className="row between">
          <h3>Timeline</h3>
          <span className="tiny muted">
            Hover for the simulated demo cursor. Select a source to review its recorded observation.
          </span>
        </div>
        <div className="timeline">
          <div className="timeline-axis">
            <span />
            <div>
              {Array.from({ length: 12 }, (_, i) => (
                <span key={i}>{8 + i}h</span>
              ))}
            </div>
          </div>
          {Object.entries(byDate)
            .sort()
            .map(([date, rows]) => (
              <div className="timeline-row" key={date}>
                <b className="num small">{shortDate(date)}</b>
                <div className="timeline-track">
                  {rows?.map((x) => {
                    const bx = s.block.find((v) => v.id === x.block_id)!;
                    const start =
                      Number(bx.start_time.slice(0, 2)) * 60 +
                      Number(bx.start_time.slice(3)) -
                      480;
                    return (
                      <button
                        key={x.id}
                        title={`${bx.start_time} – ${bx.end_time} · ${label(s, x.matter_id)} · ${x.label}`}
                        aria-pressed={x.id === l.id}
                        className={`${bx.overlaps_block_id ? "overlap" : ""} ${geometryClass(
                          {
                            left: `${(Math.max(0, start) / 660) * 100}%`,
                            width: `${Math.max(3, (bx.minutes / 660) * 100)}%`,
                            ...(preview?.blockId === bx.id
                              ? {
                                  "background-image": `linear-gradient(90deg, transparent calc(${preview.progress * 100}% - var(--cursor-width)), var(--amber) calc(${preview.progress * 100}% - var(--cursor-width)), var(--amber) calc(${preview.progress * 100}% + var(--cursor-width)), transparent calc(${preview.progress * 100}% + var(--cursor-width)))`,
                                }
                              : {}),
                          },
                          `timeline-${x.id}`,
                        )}`}
                        onMouseMove={(e) => showPreview(e, bx)}
                        onMouseLeave={() => setPreview(null)}
                        onFocus={(e) =>
                          showPreview(
                            {
                              currentTarget: e.currentTarget,
                              clientX:
                                e.currentTarget.getBoundingClientRect().left +
                                e.currentTarget.getBoundingClientRect().width /
                                  2,
                              clientY:
                                e.currentTarget.getBoundingClientRect().top,
                            } as React.MouseEvent<HTMLButtonElement>,
                            bx,
                          )
                        }
                        onBlur={() => setPreview(null)}
                        onClick={() => {
                          setPicked(x.id);
                          setFrame(0);
                          setPreview(null);
                        }}
                      >
                        {label(s, x.matter_id).split(" · ")[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      </Card>
      {preview && (
        <div
          className={`preview glass ${geometryClass({ left: `${preview.x}px`, top: `${preview.y}px` }, "source-preview")}`}
          aria-hidden="true"
        >
          <div className="row between preview-head">
            <b className="num">{preview.time}</b>
            <span className="tiny num">{preview.ref}</span>
          </div>
          <div className="preview-body">
            {preview.audio && (
              <div className="wave">
                {Array.from({ length: 32 }, (_, i) => (
                  <span key={i} className={`wave-h-${4 + ((i * 37) % 25)}`} />
                ))}
              </div>
            )}
            <p>{highlight(preview.excerpt, preview.marker)}</p>
          </div>
          <div className="preview-progress">
            <span
              className={geometryClass(
                { width: `${preview.progress * 100}%` },
                "source-progress",
              )}
            />
          </div>
        </div>
      )}
      <div className="solid pad row between">
        <div>
          <span className="small muted">
            <span className="matter-reference">{label(s, l.matter_id)}</span> ·{" "}
            {shortDate(l.date)}, {b.start_time} – {b.end_time}
          </span>
          <h2>{l.label}</h2>
        </div>
        <div className="row">
          <span className="num">
            {formatPreciseDuration(period?effectiveMs(period):null)} ·{" "}
            {period?.billable ? 'billable' : 'non billable'}
          </span>
          <span>{period?.timeValidated?'Time validated':'Time to validate'} · {period?.billingStatus ?? 'unbilled'}</span>
        </div>
      </div>
      <div className="source-layout">
        <div className="main col">
          <Card>
            <div className="row between">
              <h3>Recording</h3>
              <span className="tiny num">{f?.screenpipe_ref}</span>
            </div>
            {f ? (
              <div className="source-excerpt">
                <b>
                  {b.app} — {b.window_title}
                </b>
                {f.type === "audio" && (
                  <div className="wave" aria-hidden="true">
                    {Array.from({ length: 40 }, (_, i) => (
                      <span
                        key={i}
                        className={`wave-h-${4 + ((i * 37) % 25)}`}
                      />
                    ))}
                  </div>
                )}
                <p>{highlight(f.excerpt, f.detected_marker)}</p>
                <span className="tiny muted">
                  {f.type === "audio" ? "Local transcript" : "Screen capture"} ·{" "}
                  {f.timestamp}
                </span>
              </div>
            ) : (
              <span>No recording.</span>
            )}
            {f?.detected_marker && (
              <p className="small">
                Detected marker « {f.detected_marker} » →{" "}
                <span className="matter-reference">
                  {label(s, l.matter_id)}
                </span>
              </p>
            )}
            <div className="col">
              {sources.map((x, i) => {
                const reviewed=core.sources.find(record=>record.id===String(x.id));
                return <div className="row between line-row" key={x.id}>
                  <button className={`btn small ${i===frame?'primary':''}`} onClick={()=>setFrame(i)}>{x.timestamp} · {x.type} · {x.screenpipe_ref}</button>
                  <span className="small">{reviewed?.availabilityStatus==='unavailable'?'Unavailable in Screenpipe':reviewed?.availabilityStatus==='available'?'Available':'Availability unknown'}</span>
                  <label className="row small"><input type="checkbox" checked={reviewed?.validationStatus==='validated'} disabled={!reviewed||reviewed.validationStatus==='validated'}
                    onChange={()=>{if(reviewed)void action(api.POST('/api/sources/{instanceId}/{contentType}/{externalId}/validate',{
                      params:{path:{instanceId:reviewed.instanceId,contentType:reviewed.contentType,externalId:reviewed.externalId}},body:{},
                    }))}}/>Source validated</label>
                </div>;
              })}
            </div>
          </Card>
          <Card>
            <h3>Recognition</h3>
            {recognition?.block_id === b.id ? (
              recognition.candidates.length ? (
                recognition.candidates.map((candidate) => {
                  const matter = s.matter.find(
                    (item) => item.id === candidate.matter_id,
                  );
                  return (
                    <div key={candidate.matter_id} className="line-row">
                      <b>
                        <span className="matter-reference">
                          {matter?.reference}
                        </span>{" "}
                        {matter?.title} · {Math.round(candidate.score * 100)} %
                      </b>
                      <div className="col small">
                        {candidate.found.map((marker, index) => (
                          <span key={`${marker.type}-${marker.value}-${index}`}>
                            {marker.type} · {marker.value} · {marker.where} ·{" "}
                            {Math.round(marker.weight * 100)} %
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p>No marker found.</p>
              )
            ) : (
              <p>Loading recognition…</p>
            )}
          </Card>
          <Card>
            <h3>Jev reviews for this block</h3>
            {jev.length ? (
              jev.map((x) => (
                <div className="row between" key={x.id}>
                  <span>
                    {x.question} → <b>{x.answer}</b>
                  </span>
                  <span className="tiny muted">
                    p = {x.probability.toLocaleString("en-IE")} · sent:{" "}
                    {x.sent_data}
                  </span>
                </div>
              ))
            ) : (
              <span className="muted">No review requested.</span>
            )}
          </Card>
        </div>
        <div className="side col">
          <Card>
            <h3>Audit trail</h3>
            {audit.map((x) => (
              <div className="audit-row" key={x.id}>
                <span className="tiny muted num">
                  {x.timestamp} · {x.actor}
                </span>
                <b>{x.action}</b>
                <span className="tiny muted">
                  {x.before}
                  {x.before && " → "}
                  {x.after}
                </span>
              </div>
            ))}
          </Card>
          <div className="solid pad col" id="source-pack">
            <h3>Source pack</h3>
            <span className="small muted">
              For a disputed invoice or professional review.
            </span>
            {[
              ["o1", "Blur other visible clients"],
              ["o2", "Exclude personal apps"],
              ["o3", "Include transcripts"],
              ["o4", "Include audit trail"],
            ].map(([id, text]) => (
              <label className="row small" key={id}>
                <input
                  type="checkbox"
                  checked={options.includes(id)}
                  onChange={(e) =>
                    setOptions(
                      e.target.checked
                        ? [...options, id]
                        : options.filter((x) => x !== id),
                    )
                  }
                />
                {text}
              </label>
            ))}
            <button
              className="btn"
              onClick={async () => {
                await action(
                  api.POST("/api/sources/{id}/export", {
                    params: { path: { id: l.id } },
                    body: { options },
                  }),
                );
              }}
            >
              Generate source pack and hash
            </button>
            {s.source_export
              .filter((pack) =>
                pack.time_entry_ids.split(",").includes(String(l.id)),
              )
              .map((pack) => (
                <div className="source-pack-history" key={pack.id}>
                  <span className="small muted">{pack.created_at}</span>
                  <span className="tiny num hash">SHA-256 {pack.sha256}</span>
                </div>
              ))}
            {!s.source_export.some((pack) =>
              pack.time_entry_ids.split(",").includes(String(l.id)),
            ) && (
              <span className="small muted">
                No source pack generated for this entry.
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

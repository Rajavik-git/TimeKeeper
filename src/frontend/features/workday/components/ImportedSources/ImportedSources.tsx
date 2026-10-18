import { useEffect, useMemo, useState } from "react";
import { caseLabel, type CoreState, type State } from "../../../../api/client";
import {
  availabilityLabels,
  sourceValidationLabels,
} from "../../../../shared/presentation/work-period";
import { newestSources, sourceDate, sourceTypeLabel } from "../../lib/importedSources";
import "./ImportedSources.css";

type Props = {
  sources: CoreState["sources"];
  periods: CoreState["periods"];
  catalogState: State;
};
const PAGE_SIZE = 50;

export function ImportedSources({ sources, periods, catalogState }: Props) {
  const [search, setSearch] = useState("");
  const [linkStatus, setLinkStatus] = useState("all");
  const [contentType, setContentType] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const periodsById = useMemo(
    () => new Map(periods.map((period) => [period.id, period])),
    [periods],
  );
  const types = useMemo(
    () => [...new Set(sources.map((source) => source.contentType))].sort(),
    [sources],
  );
  const sorted = useMemo(() => newestSources(sources), [sources]);
  const query = search.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      sorted.filter((source) => {
        const linked = source.workPeriodId !== null;
        if (linkStatus === "linked" && !linked) return false;
        if (linkStatus === "unlinked" && linked) return false;
        if (contentType !== null && source.contentType !== contentType) return false;
        if (!query) return true;
        const period = source.workPeriodId ? periodsById.get(source.workPeriodId) : undefined;
        return [
          source.id,
          source.externalId,
          source.instanceId,
          source.contentType,
          sourceTypeLabel(source.contentType),
          source.appName,
          source.windowName,
          source.excerpt,
          source.recordedAt,
          period?.label,
          period?.caseId ? caseLabel(catalogState, period.caseId) : null,
        ].some((value) => value?.toLocaleLowerCase().includes(query));
      }),
    [sorted, linkStatus, contentType, query, periodsById, catalogState],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visiblePage = Math.min(page, pageCount);
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);
  const start = (visiblePage - 1) * PAGE_SIZE;
  const visibleSources = filtered.slice(start, start + PAGE_SIZE);
  const filteredActive = Boolean(search || linkStatus !== "all" || contentType !== null);
  function clearFilters() {
    setSearch("");
    setLinkStatus("all");
    setContentType(null);
    setPage(1);
  }

  return (
    <section className="card imported-sources" aria-labelledby="imported-sources-title">
      <div className="card-h">
        <div className="t">
          <h2 id="imported-sources-title">Imported sources</h2>
          <p>
            All source references currently saved in TimeKeeper, including those without a work
            period.
          </p>
        </div>
      </div>
      <div className="imported-sources-controls">
        <label>
          Search sources
          <input
            className="input"
            type="search"
            value={search}
            placeholder="App, window, text, case, or source ID"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Work period link
          <select
            className="select"
            value={linkStatus}
            onChange={(event) => {
              setLinkStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All sources</option>
            <option value="unlinked">Not linked to a work period</option>
            <option value="linked">Linked to a work period</option>
          </select>
        </label>
        <label>
          Content type
          <select
            className="select"
            value={contentType === null ? "all" : `type:${contentType}`}
            onChange={(event) => {
              setContentType(event.target.value === "all" ? null : event.target.value.slice(5));
              setPage(1);
            }}
          >
            <option value="all">All types</option>
            {contentType !== null && !types.includes(contentType) && (
              <option value={`type:${contentType}`}>{sourceTypeLabel(contentType)}</option>
            )}
            {types.map((type) => (
              <option key={type} value={`type:${type}`}>
                {sourceTypeLabel(type)}
              </option>
            ))}
          </select>
        </label>
        {filteredActive && (
          <button className="btn" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>
      <p className="imported-sources-scope">
        This list shows saved references, not complete Screenpipe history. Viewing them does not
        create worked time. Sync links observations only when one existing work period matches their
        recording time. Sources can remain unlinked when no period or overlapping periods match.
        Media is not loaded from Screenpipe.
      </p>
      <p className="imported-sources-count" role="status" aria-live="polite">
        {filtered.length
          ? `${start + 1}–${start + visibleSources.length} of ${filtered.length} matching sources`
          : "0 matching sources"}
        . {sources.length} saved in TimeKeeper.
      </p>
      {sources.length === 0 ? (
        <p className="imported-sources-empty">
          No sources have been imported. Check the connection and import status in Settings →
          Screenpipe.
        </p>
      ) : filtered.length === 0 ? (
        <p className="imported-sources-empty">
          No sources match these filters. Clear the filters to show all saved references.
        </p>
      ) : (
        <div
          className="imported-sources-table"
          role="region"
          aria-label="Imported source references"
          tabIndex={0}
        >
          <table>
            <caption className="sr-only">
              Saved source references, newest recordings first. Times use your local timezone.
            </caption>
            <thead>
              <tr>
                <th scope="col">Recorded locally</th>
                <th scope="col">Content type</th>
                <th scope="col">Work period and case</th>
                <th scope="col">Source validation</th>
                <th scope="col">Availability</th>
                <th scope="col">Source identity</th>
                <th scope="col">Observed context and excerpt</th>
              </tr>
            </thead>
            <tbody>
              {visibleSources.map((source) => {
                const period = source.workPeriodId
                  ? periodsById.get(source.workPeriodId)
                  : undefined;
                const date = sourceDate(source.recordedAt);
                return (
                  <tr key={source.id}>
                    <td>
                      {date ? (
                        <time dateTime={source.recordedAt}>{date}</time>
                      ) : (
                        "Recording time unavailable"
                      )}
                    </td>
                    <td>{sourceTypeLabel(source.contentType)}</td>
                    <td>
                      {source.workPeriodId === null ? (
                        "Not linked to a work period"
                      ) : period ? (
                        <>
                          <span>{period.label || "Work period"}</span>
                          <small>
                            {period.caseId
                              ? caseLabel(catalogState, period.caseId)
                              : "No case assigned"}
                          </small>
                        </>
                      ) : (
                        "Linked work period unavailable"
                      )}
                    </td>
                    <td>{sourceValidationLabels[source.validationStatus]}</td>
                    <td>{availabilityLabels[source.availabilityStatus]}</td>
                    <td>
                      <span>
                        Screenpipe ID: <code>{source.externalId}</code>
                      </span>
                      <small>
                        Instance: <code>{source.instanceId}</code>
                      </small>
                    </td>
                    <td>
                      {source.appName && <span>App: {source.appName}</span>}
                      {source.windowName && <small>Window: {source.windowName}</small>}
                      {source.excerpt ? (
                        <details>
                          <summary>Source excerpt</summary>
                          <p className="imported-source-excerpt">{source.excerpt}</p>
                        </details>
                      ) : (
                        <span className="imported-source-no-text">
                          Metadata only. No stored text.
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <nav className="imported-sources-pagination" aria-label="Imported sources pages">
        <button
          className="btn"
          disabled={visiblePage === 1}
          onClick={() => setPage(visiblePage - 1)}
        >
          Previous page
        </button>
        <span>
          Page {visiblePage} of {pageCount}
        </span>
        <button
          className="btn"
          disabled={visiblePage === pageCount}
          onClick={() => setPage(visiblePage + 1)}
        >
          Next page
        </button>
      </nav>
    </section>
  );
}

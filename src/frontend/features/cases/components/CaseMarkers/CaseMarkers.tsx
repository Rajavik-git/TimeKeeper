import { markerTypeLabels } from "../../../../shared/presentation/catalog";
import { MarkerType } from "../../../../../contracts/states.generated";
const editableMarkerTypes = [
  MarkerType.CaseNumber,
  MarkerType.OpposingParty,
  MarkerType.File,
  MarkerType.Email,
  MarkerType.Domain,
  MarkerType.Keyword,
] as const;
type EditableMarkerType = (typeof editableMarkerTypes)[number];
import { useState, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { api, type ScreenProps, type Case, type State } from "../../../../api/client";

type Props = Pick<ScreenProps, "refresh"> & {
  currentCase: Case;
  markers: State["markers"];
  builtInMarkers: { value: string; type: MarkerType; badge: boolean }[];
  markerCount: number;
  sortedHeading: (label: string, column: number) => ReactNode;
  showMarkerForm: boolean;
  setShowMarkerForm: Dispatch<SetStateAction<boolean>>;
  showNotice: (message: string) => void;
};
export function CaseMarkers({
  currentCase,
  markers,
  builtInMarkers,
  markerCount,
  sortedHeading,
  showMarkerForm,
  setShowMarkerForm,
  showNotice,
  refresh,
}: Props) {
  const [markerValue, setMarkerValue] = useState("");
  const [markerType, setMarkerType] = useState<EditableMarkerType>(MarkerType.Keyword);
  const [savingMarker, setSavingMarker] = useState(false);
  return (
    <>
      <div className="card-b muted marker-intro">
        Names, files, and words configured as recognition markers for this case.
      </div>
      <div className="tbl case-marker-table">
        <table className="data-table">
          <thead>
            <tr>
              {sortedHeading("Marker", 0)}
              {sortedHeading("Type", 1)}
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {builtInMarkers.map((marker) => (
              <tr key={`builtin-${marker.type}`}>
                <td>
                  {marker.badge ? (
                    <span className="case-ref-badge">{marker.value}</span>
                  ) : (
                    marker.value
                  )}
                </td>
                <td>{markerTypeLabels[marker.type]}</td>
                <td />
              </tr>
            ))}
            {markers.map((marker) => (
              <tr key={marker.id}>
                <td title={marker.value}>{marker.value}</td>
                <td>
                  {markerTypeLabels[marker.type]}
                  {marker.learned ? " · learned from you" : ""}
                </td>
                <td>
                  <span className="case-rowact">
                    <button
                      className="btn sm ghost"
                      disabled={savingMarker}
                      aria-label={`Remove ${marker.value}`}
                      onClick={async () => {
                        setSavingMarker(true);
                        showNotice("Removing marker…");
                        try {
                          const response = await api.DELETE("/api/catalog/markers/{id}", {
                            params: { path: { id: marker.id } },
                          });
                          if (response.error) showNotice("Could not remove marker.");
                          else {
                            await refresh();
                            showNotice("Marker removed");
                          }
                        } catch {
                          showNotice("Could not remove marker.");
                        } finally {
                          setSavingMarker(false);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {!markerCount && (
              <tr>
                <td colSpan={3} className="case-empty">
                  No markers yet.{" "}
                  <button onClick={() => setShowMarkerForm(true)}>Add a marker</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {showMarkerForm && (
        <div className="card-b row">
          <select
            className="field"
            aria-label="Marker type"
            value={markerType}
            onChange={(event) => {
              const selected = editableMarkerTypes.find(
                (value) => value === event.currentTarget.value,
              );
              if (selected !== undefined) setMarkerType(selected);
            }}
          >
            {editableMarkerTypes.map((type) => (
              <option key={type} value={type}>
                {markerTypeLabels[type]}
              </option>
            ))}
          </select>
          <input
            className="field grow"
            aria-label="New marker"
            placeholder="Name, file, keyword…"
            value={markerValue}
            onChange={(event) => setMarkerValue(event.target.value)}
          />
          <button
            className="btn"
            disabled={savingMarker || !markerValue.trim()}
            onClick={async () => {
              if (markerValue.trim()) {
                setSavingMarker(true);
                showNotice("Adding marker…");
                try {
                  const response = await api.POST("/api/catalog/markers", {
                    body: {
                      caseId: currentCase.id,
                      type: markerType,
                      value: markerValue.trim(),
                    },
                  });
                  if (response.error) showNotice("Could not add marker.");
                  else {
                    await refresh();
                    setMarkerValue("");
                    setShowMarkerForm(false);
                    showNotice("Marker added");
                  }
                } catch {
                  showNotice("Could not add marker.");
                } finally {
                  setSavingMarker(false);
                }
              }
            }}
          >
            {savingMarker ? "Adding…" : "Add marker"}
          </button>
        </div>
      )}
    </>
  );
}

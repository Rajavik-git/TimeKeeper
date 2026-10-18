export function DraftActions({
  discarding,
  keepEditing,
  discard,
}: {
  discarding: boolean;
  keepEditing: () => void;
  discard: () => void;
}) {
  if (!discarding) return null;
  return (
    <div className="draft-discard" role="alert">
      <p>Discard unsaved changes?</p>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={keepEditing}>
          Keep editing
        </button>
        <button type="button" className="btn" onClick={discard}>
          Discard changes
        </button>
      </div>
    </div>
  );
}

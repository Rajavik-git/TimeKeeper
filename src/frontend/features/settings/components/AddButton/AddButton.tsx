import { Icon } from "../../../../shared/components/Icon/Icon";

export function AddButton({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button className="btn sm" onClick={onToggle}>
      {open ? (
        "Cancel"
      ) : (
        <>
          <Icon name="plus" small />
          {label}
        </>
      )}
    </button>
  );
}

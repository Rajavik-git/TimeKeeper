import { WorkPill } from "../components/WorkPill/WorkPill";
import { usePillController } from "../hooks/usePillController";
export function Pill() {
  return <WorkPill {...usePillController()} />;
}

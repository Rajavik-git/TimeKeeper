import { defaultWeights, type MarkerType } from "../domain/recognition.js";
import type { AssignmentPort } from "../ports/assignment.js";

export function updateTimeEntry(port: AssignmentPort, id: number, body: Record<string, unknown>) {
  return port.transaction(() => {
    const before = port.timeEntry(id);
    if (!before) throw Error("Not found");
    if (before.billing_status === "billed") throw Error("Time entry already billed");
    const allowed = ["matter_id", "billable", "reason", "label", "review_status"];
    if (Object.keys(body).some((key) => !allowed.includes(key))) throw Error("Field not allowed");
    if (body.review_status === "approved" && !(body.matter_id ?? before.matter_id))
      throw Error("Assign a case first");
    const after = port.updateTimeEntry(id, {
      ...body,
      ...("billable" in body ? { billing_status: body.billable ? "to_bill" : "not_billable" } : {}),
    });
    if ("matter_id" in body && after.block_id) {
      const blockId = Number(after.block_id);
      port.updateBlock(blockId, {
        matter_id: after.matter_id,
        state: after.matter_id ? "assigned" : "to_check",
      });
      if (after.matter_id) {
        const block = port.block(blockId);
        if (!block) throw Error("Not found");
        const type: MarkerType = /mail|messag|outlook|thunderbird/i.test(String(block.app)) ? "email" : "file";
        const value = String(block.window_title).trim();
        if (value && !port.markers().some((marker) =>
          marker.matter_id === after.matter_id && marker.type === type &&
          String(marker.value).toLocaleLowerCase() === value.toLocaleLowerCase()
        )) {
          port.addMarker({ matter_id: after.matter_id, type, value, weight: defaultWeights[type], learned: true });
          port.audit("Marker learned", "", value, id, blockId, "TimeKeeper");
        }
      }
    }
    const result = port.timeEntry(id);
    if (!result) throw Error("Not found");
    port.audit("Time entry updated", JSON.stringify(before), JSON.stringify(result), id,
      result.block_id == null ? null : Number(result.block_id));
    return result;
  });
}

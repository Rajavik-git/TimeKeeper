---
schedule: manual
enabled: true
title: Generate TimeKeeper work periods
description: "Prepare reviewable work-period proposals for a history job requested in TimeKeeper."
timeout: 900
---

# Generate TimeKeeper work-period proposals

The lawyer requested history generation in TimeKeeper. Run once and stop.

1. Call the TimeKeeper MCP tool `generate_history_proposals` once with no arguments.
2. Report its returned status and proposal count only. Do not retrieve screen text or case lists into this chat.

`ready` means draft proposals are available in **Activity → History proposals**. The lawyer must review and accept each proposal. `no-pending-job` means no work was requested. All other statuses mean generation did not finish successfully. Report the status without retrying or creating periods yourself.

If the tool is unavailable, report that the TimeKeeper MCP connection needs to be updated and enabled. Do not run shell commands, install dependencies, read environment files, invoke JEV yourself, or use live case-transition tools as a substitute. The requested job expires if it cannot be claimed.

---
schedule: manual
enabled: true
title: End TimeKeeper
description: "End the active TimeKeeper session. Screenpipe keeps recording."
timeout: 120
---

# End TimeKeeper

The lawyer ran this pipe on purpose: it is the End TimeKeeper button. End the active TimeKeeper session. Run once and stop. Do not schedule, repeat, or retry this run.

## Steps

1. If the `timekeeper` MCP tool `end_session` is available, call it once with no arguments.
2. Otherwise, check for `.env` beside this installed `pipe.md`, independently of the shell's working directory. If it defines `TIMEKEEPER_END_COMMAND`, run that command once, exactly as written, and read the JSON it prints. Do not edit it, build another command, or call the TimeKeeper HTTP API yourself.
3. If neither is available, report `blocked: TimeKeeper MCP tool and TIMEKEEPER_END_COMMAND are both unavailable` and stop.

Do not install dependencies, create files, or end the session any other way. Never stop Screenpipe recording.

## Report

Use the result's `status` field:

- `ended`: report "TimeKeeper session ended" with `session.id` and `session.endedAt`. Tab detection stops by itself within about 10 seconds.
- `no_active_session`: report that no TimeKeeper session was active. Nothing changed.
- `timekeeper_not_running`: report that TimeKeeper is closed, so the end was not delivered and the session is still active. Ask the lawyer to open TimeKeeper and run this pipe again.
- `pending`: report that the end is waiting and has not been applied.
- `unconfirmed`: report that the outcome is unknown. Do not run the command again.
- `error`: report `error` and `message`.

Only `ended` means the session ended. Never describe any other status as success. If the Screenpipe `send-notification` tool is available, also send the one-line report as a notification.

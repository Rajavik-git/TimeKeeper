---
schedule: manual
enabled: true
title: Start TimeKeeper
description: "Start a TimeKeeper session. Does nothing if one is already running."
timeout: 120
---

# Start TimeKeeper

The lawyer ran this pipe on purpose: it is the Start TimeKeeper button. Start a TimeKeeper session only if none is active. Run once and stop. Do not schedule, repeat, or retry this run.

## Steps

1. If the `timekeeper` MCP tool `start_session` is available, call it once with no arguments.
2. Otherwise, check for `.env` beside this installed `pipe.md`, independently of the shell's working directory. If it defines `TIMEKEEPER_START_COMMAND`, run that command once, exactly as written, and read the JSON it prints. Do not edit it, build another command, or call the TimeKeeper HTTP API yourself.
3. If neither is available, report `blocked: TimeKeeper MCP tool and TIMEKEEPER_START_COMMAND are both unavailable` and stop.

Both paths return the same JSON result. Do not install dependencies, create files, or start TimeKeeper any other way.

## Report

Use the result's `status` field:

- `started`: report "TimeKeeper session started" with `session.id` and `session.startedAt`.
- `already_active`: report "TimeKeeper session already running" with `session.id` and `session.startedAt`. Nothing was changed.
- `timekeeper_not_running`: report that TimeKeeper is closed or not ready and that no session was started. Ask the lawyer to open TimeKeeper and run this pipe again.
- `pending`: report that the start is waiting and has not been applied.
- `unconfirmed`: report that the outcome is unknown. Do not run the command again.
- `error`: report `error` and `message`.

Only `started` and `already_active` mean a session is running. Never describe any other status as success. If the Screenpipe `send-notification` tool is available, also send the one-line report as a notification.

Ending a session is not handled here. Screenpipe keeps recording whether or not a TimeKeeper session is active.

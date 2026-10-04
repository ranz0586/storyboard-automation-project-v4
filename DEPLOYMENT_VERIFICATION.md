# Deployment verification pending

The user confirmed on 2026-10-03 that this application is running locally and is not deployed. Local process restart tests do not prove durable hosting storage, deployed scheduling, or routing/session behavior. This checklist preserves that remaining requirement; it is not a deployment success report.

## Before the check

- Identify the deployed URL, service/process manager and persistent disk mount. Use a dedicated test account/project; record Airtable record IDs separately from the custom project key.
- Verify the built React assets are present and `/health` responds. Confirm configured model names from startup logs without exposing keys.
- Verify `RUN_STATE_PATH`, `SCHEDULE_STATE_PATH`, `SCRIPT_LOCK_DIR` and registration locks use persistent paths. Same-host processes must share these paths. Do not use the JSON stores across different hosts.
- Choose one server process for the first check. Extra processes require a deliberate session/routing plan and aggregate queue/key/quota limits; those remain process-local.
- Obtain authorization for the concrete test's Gemini calls, Airtable writes and any Telegram alerts. The live local-output authorization does not authorize a new deployment or production lifecycle writes.

## Restart and persistence check

1. Log in and create a two-idea script run in the dedicated project. Capture run ID, selected idea IDs, successful item identities and saved Script identities.
2. After the first Script is persisted, use the service's process manager to restart the test service while remaining work is in flight. Do not interrupt unrelated processes.
3. Verify `/health` and React assets recover. Confirm the previous session is rejected, then log in again. Verify saved schedules and run history survive with the original identities/counts.
4. Confirm the stopped owner's unfinished run becomes `INTERRUPTED`. Resume it from the dashboard. A crash-held script lock retains its ten-minute expiry; do not shorten or delete a live lock to make the test pass.
5. Verify the replacement requests only unfinished work, the completed Script is reused, and final Airtable counts show exactly one Script per Idea identity. Capture both original and replacement run IDs.
6. If a short JSON transaction lock was abandoned, stop every server using those files, use `node scripts/recover-state-locks.mjs --servers-stopped`, then restart. Record that recovery was required. Never run recovery while an owner remains live.

## Scheduling and storyboard check

1. Configure a weekly occurrence in the dedicated project. Verify edit/re-enable waits for the next occurrence rather than backfilling an earlier one.
2. Restart before the next due occurrence and verify the saved configuration survives. At the occurrence, verify one scheduled run is claimed. If manually resuming an interrupted scheduled run, verify the scheduler follows its replacement rather than replaying the ancestor.
3. Approve one complete Script and run the configured storyboard poller. Verify usable saved output, one Storyboard identity, `Story Generated` status and project-owned activity.
4. A status-only retry must reuse the saved storyboard. Exercise ambiguous writes/failures only in an isolated environment with controlled fault injection; local mocked coverage is not proof of those failures against a production provider.

## Evidence needed to close the goal

Record timestamps, deployed service/version, persistent path configuration (no secrets), startup/restart results, original/replacement run IDs, schedule occurrence, before/after Airtable identities/counts, activity outcomes and any observed errors/quota responses. Redact account credentials and cookie values. Until these checks are executed against an actual deployed service, deployed restart behavior remains unverified.

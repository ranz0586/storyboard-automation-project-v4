Dashboard port to Vercel — 2026-10-21

Migration batch M1 ports the established localhost task workspace and saved-package reader into `D:\GitHub\storyboard-automation-project-v4`.

- Ideas: manual full pipeline, expandable separate idea/script generation, draft recovery and cross-page selection.
- Scripts: existing narration/scenes, paging and explicit approval.
- Storyboards: all saved Structure 1 frames, Structure 2 scene references and Structure 3 panels/keyframes, full prompt copying, saved JSON and printable HTML draft sheets. Open the downloaded sheets in a browser and Print / Save as PDF.
- Settings: existing weekly schedule and project status.
- Activity: existing progress, errors, retry and interrupted-run recovery, with a shortcut when work is running or needs attention.

Tabs support arrow keys, Home/End and focusable panels. Inactive panels remain mounted to retain unsaved schedule edits and idea selections; changing project resets local state. Empty paging controls are hidden.

The reader supports clock-string and numeric timing displays, legacy plain-text summaries with separate structure JSON, and legacy Structure 1 panel_prompt image descriptions. JSON export retains every raw saved field. HTML export escapes source text, keeps complete long prompts and uses per-panel page breaks. No image previews are invented; reference descriptions remain descriptions.

No backend, agent, timing/fidelity gate, authentication, database schema or cloud dispatch change is included. ProjectDetail data loading, request handlers, actions and polling were compared to the pre-port version and retained. Localhost source is unchanged. Existing uncommitted Vercel Phase 4 work is preserved.

Brief editing, plan auditing/readiness, alternate inputs/blueprints, new generation format controls, rendering and analytics are outside M1. The UI calls no absent brief/audit/creation/export APIs. Existing saved brief metadata is displayed only if already present; it does not create a brief store. Export is explicitly draft-only.

Verification: 192 backend tests, all 11 mocked browser workflows, and a focused stronger stale-project-metadata check passed. Desktop/tablet/mobile renders at 1440/768/390px were inspected; tests prove no horizontal overflow, complete long-text copying and exports, legacy image descriptions, keyboard navigation and unsaved-state retention. The Impeccable source detector reported no findings. `npm run test:vercel` passed static/API/Workflow trigger/missing-database checks. The refreshed KOS graph is current (676 code nodes). Mocked provider tests do not establish live generation quality or deployment availability.

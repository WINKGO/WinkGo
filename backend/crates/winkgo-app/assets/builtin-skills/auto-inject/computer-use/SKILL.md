---
name: computer-use
description: >-
  Control visible native Windows applications through WINK GO Desktop Computer Use, and control websites through the separate WINK GO in-app Browser Computer Use. Use when the user asks the Agent to open, inspect, click, type, or complete a visible task in a desktop application or webpage.
---

# WINK GO Computer Use

WINK GO exposes two independent visible automation tools. Choose by target surface:

- Native Windows application: call `run_desktop_task` for the complete multi-step goal.
- Website in the WINK GO in-app browser: call `run_browser_task`.

## Route the goal before acting

Choose the most structured surface that can complete and verify the goal:

1. **Office/PDF file content** (`.docx/.xlsx/.pptx/.pdf`, Word document, spreadsheet, slides): use `officecli` first. Do not open Word/Excel and click visually when the file can be edited structurally.
2. **Website or online flow**: use `run_browser_task` in the WINK GO in-app browser. Never substitute system Chrome, Edge, `start`, shell, or `windows_open_url`.
3. **Canvas/WebGL/game/map/chart/remote web UI**: still use `run_browser_task`; request a browser screenshot and use bounded visual coordinates only when DOM refs cannot represent the target.
4. **Native Windows GUI**: use `run_desktop_task` only when the goal explicitly depends on a visible local application, menu, setting, or window.
5. **Compound workflow**: execute in order. Example: browser download → OfficeCLI edit and validate; browser download → native app only when the user explicitly requires the real app UI.

Never report success from a tool's optimistic return alone. Match the route to its proof:

- Browser: fresh DOM/page screenshot after the final action.
- Canvas/WebGL: fresh visual browser screenshot showing the changed game/app state.
- Office/PDF: `validate` plus a rendered screenshot/HTML/page inspection of the saved file.
- Desktop: fresh target-window screenshot after the final action.

## Desktop rules

1. Use `run_desktop_task` for a complete multi-step native Windows goal. WINK GO's dedicated visual controller owns the screenshot-analysis-action-verification loop and renders the control border and cursor feedback.
2. Use `observe_desktop` and `desktop_action` only for one explicit low-level action or diagnosis. Reuse the same session and inspect the fresh screenshot after every action.
3. Keep one desktop task bounded to at most 12 actions and stop if the screen is not progressing.
4. Never use `start`, `explorer`, PowerShell, shell commands, or the system default browser as a substitute for visible WINK GO Computer Use.
5. Report success only when the final returned screenshot visibly verifies the requested result. If an action is blocked or fails, report that state honestly.
6. Sending, publishing, purchasing, deleting, uploading, signing in, entering passwords or verification codes, and changing permissions require the user's exact confirmation at execution time.
7. `run_desktop_task` uses the visual model configured in WINK GO, without exposing its API key to the Agent. If no visual model is available, report the configuration error instead of falling back to shell or blind clicks.

## Browser rules

1. Use `run_browser_task` for multi-step website work in the visible WINK GO in-app browser.
2. Use `browser_action` only for one explicit low-level browser action or diagnosis.
3. Do not use desktop control to operate a website when the WINK GO browser tool can do it semantically.
4. For pixel-only content, use the screenshot returned by Browser Computer Use. Screenshot coordinates are mapped back to the live viewport and rejected when out of bounds.
5. Login/QR flows follow the user's Settings permission. Passwords, OTPs, CAPTCHAs, QR payloads, tokens and payment data remain manual and must not be read or filled by the Agent.

Recorded Browser Skills and deterministic Desktop Skills remain separate from these AI-driven Computer Use tools.

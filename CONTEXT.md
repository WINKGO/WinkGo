# WINK GO Commercial Access

This context defines how WINK GO sells cloud services and optional desktop capabilities without splitting the desktop application into permanently divergent editions.

## Accounts and sales

**Account**:
The customer identity used to sign in, purchase products, and own devices and entitlements.
_Avoid_: License account, desktop account

**Product**:
A sellable WINK GO offering such as Pro monthly service or a permanent skill pack.
_Avoid_: Edition, version

**Purchase**:
A completed one-time payment that may grant one or more entitlements.
_Avoid_: Activation, license

**Subscription**:
A renewable agreement that grants entitlements while it is active or within its offline grace period.
_Avoid_: Membership record, recurring license

## Access control

**Capability**:
A stable machine-readable feature right such as `mcp.managed`, `skills.premium`, or `inspiration.full`.
_Avoid_: Feature flag, VIP switch

**Entitlement**:
An account's time-bounded or permanent grant of a capability, created from a purchase, subscription, promotion, or administrator action.
_Avoid_: Permission, license

**Entitlement Snapshot**:
A server-signed, locally cached statement of the account's current capabilities and offline grace deadline.
_Avoid_: Heartbeat, activation code

**Device**:
One registered installation of WINK GO that may consume an account's allowed device count.
_Avoid_: Computer session, machine license

## Delivery

**Core Application**:
The single WINK GO desktop application installed by every customer and updated through the application update channel.
_Avoid_: Free edition, Pro executable

**Module**:
A signed, versioned optional package downloaded after an entitlement check and executed locally by the Core Application.
_Avoid_: Patch, edition

**Managed MCP Service**:
A WINK GO-operated cloud connector or relay whose credentials, availability, and usage are controlled by an entitlement.
_Avoid_: MCP configuration

**Local MCP Configuration**:
Customer-managed MCP endpoints and credentials that run through the Core Application without requiring a WINK GO-managed service.
_Avoid_: Free MCP service

**Catalog**:
The server-provided list of modules and managed services visible to the current account, including compatibility and download metadata.
_Avoid_: App update feed, skill folder

# WINK GO Computer Use

WINK GO exposes two independent Computer Use skills. They share no recorder, workflow store, execution session, or IPC runner.

## Desktop Computer Use

**Desktop Computer Use Session**:
A bounded model-driven session that observes and operates visible Windows applications through the local desktop runtime.
_Avoid_: Recorded desktop macro, hidden desktop, browser session

**Desktop Observation**:
A fresh screenshot plus bounded OCR and UI Automation references for one safe external Windows target.
_Avoid_: Browser DOM, stale screenshot

**Desktop Action**:
One validated click, text input, key, shortcut, or scroll operation selected from the current Desktop Observation.
_Avoid_: Recorded workflow step, arbitrary shell command

**Desktop Control Border**:
The visible indicator that a Desktop Computer Use Session is observing or controlling Windows.
_Avoid_: Recording border, decorative animation

## Built-in Browser Computer Use

**Browser Computer Use Session**:
A bounded model-driven session attached only to the visible WINK GO built-in browser tab.
_Avoid_: Desktop session, Chrome session, hidden browser

**Browser Observation**:
A fresh page snapshot containing bounded semantic DOM references from the attached built-in browser tab.
_Avoid_: Desktop screenshot, recorded trace

**Browser Action**:
One validated navigation or DOM interaction selected from the current Browser Observation and executed through the built-in browser bridge.
_Avoid_: Windows input injection, recorded browser workflow

## Computer Use boundaries

- Desktop Computer Use and Built-in Browser Computer Use have separate UI entries, status streams, cancellation controls, IPC bridges, and execution services.
- Neither skill records user activity or saves a reusable workflow.
- Each run uses the provider and model explicitly selected by the user and performs a fresh observe-plan-act-verify loop with a finite step limit.
- Desktop Computer Use can operate only a policy-approved visible Windows target; it must not target WINK GO, its runtime, overlays, or system surfaces.
- Built-in Browser Computer Use can operate only the attached WINK GO browser tab; it must not silently launch or control Chrome or another external browser.
- Passwords, verification codes, tokens, payment data, and other secrets are not persisted in observations, logs, or device messages.
- Sending, purchasing, deleting, publishing, changing security settings, and other consequential actions require explicit confirmation at execution time.

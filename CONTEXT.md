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

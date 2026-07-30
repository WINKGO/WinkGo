# Use one desktop client with entitlement-delivered premium modules

WINK GO will keep one desktop application and one application update channel. Free and paid access will be expressed as server-issued capability entitlements; premium skills, inspiration packs, and optional connectors will be distributed as separately signed modules, while managed MCP services remain cloud services and local desktop execution remains on the customer's computer. This avoids permanent Free/Pro codebase drift, allows immediate upgrades after payment, reduces the base installer, and prevents premium source packages from being exposed in every installer.

## Consequences

- UI visibility is not an access boundary: entitlement checks must run in the Electron main process and cloud APIs as well as the renderer.
- Application versions, module versions, catalog versions, and entitlement versions are independent.
- Losing or expiring an entitlement disables premium entry points and cloud services but never deletes customer data.
- A separately built offline enterprise bundle may be added later, but it is not the default consumer distribution model.

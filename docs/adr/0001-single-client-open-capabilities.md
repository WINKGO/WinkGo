# Use one desktop client with open capabilities

WINK GO keeps one desktop application, one source tree, and one public update
channel. The capabilities shipped in the public desktop client are available
to every user; product navigation and local execution do not depend on a paid
edition flag.

External models, APIs, hosted relay capacity, speech services, messaging
platforms, and other independently operated resources may still require the
user's own credentials or incur provider charges. Those service costs are
separate from access to the desktop features and must be disclosed at the
point where the service is configured or used.

## Consequences

- A build-edition value may be read only for backward-compatible migration; it
  must not hide or disable a capability in the public client.
- Application versions, optional integration versions, and provider service
  versions remain independent.
- A provider outage, expired credential, or unavailable hosted resource may
  disable only that external connection and must never delete local user data.
- Any future optional service offering requires its own clear description,
  operator identity, price, privacy terms, and user consent. It does not
  retroactively restrict rights granted by an already published open-source
  release.

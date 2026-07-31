# WINK GO modifications

WINK GO contributors modified the pinned Wry implementation in 2026.
The adapted code:

- is packaged as a standalone Windows N-API module for Electron instead of
  Wry's WebView2 module;
- converts Wry drag events into a bounded, serialized event queue exposed to
  JavaScript;
- installs and retains COM drop targets for Electron window handles;
- adds virtual-file extraction limits, filename sanitization, temporary-file
  management, and error handling for application use; and
- changes imports, types, callbacks, and public entry points to fit the
  WINK GO desktop architecture.

The original copyright and dual-license identifiers are retained at the top
of `../../src/lib.rs`.

# sharp and libvips distribution information

WINK GO uses the npm package `sharp` version `0.35.3` while generating
installer artwork. The locally selected target-specific prebuilt package
reports libvips version `8.18.3`.

- sharp source: <https://github.com/lovell/sharp/tree/v0.35.3>
- libvips source: <https://github.com/libvips/libvips/tree/v8.18.3>
- sharp installation/build documentation:
  <https://sharp.pixelplumbing.com/install/>
- libvips build documentation:
  <https://www.libvips.org/install.html>

The target-specific sharp package declares
`Apache-2.0 AND LGPL-3.0-or-later`. WINK GO does not modify sharp or libvips.
Their complete Apache 2.0, LGPL v3, and referenced GPL v3 license texts are
included in the conservative dependency license archive.

Neither sharp nor libvips is a runtime dependency of WINK GO. Electron Builder
excludes `node_modules/sharp`, `node_modules/@img/sharp-*`, and their Bun store
payloads; the post-pack audit rejects any sharp/libvips path or binary marker.
They are therefore not conveyed in WINK GO end-user installers or the compiled
web CLI.

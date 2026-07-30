# WinkGo extension schemas

`winkgo-extension-v1.json` describes the `winkgo-extension.json` contract used by the current backend.

- Canonical manifest fields use `snake_case`.
- Compatibility aliases used by existing extensions, such as `displayName`, `acpAdapters`, and `entryPoint`, remain valid.
- Contribution arrays may be stored in separate JSON files with a `$file:path/to/file.json` reference.
- Unknown properties remain allowed because the runtime parser is forward-compatible and ignores fields it does not consume.
- JSON Schema tools validate a `$file:` reference as a string. Validation that resolves and checks referenced files must be performed by the loader or an equivalent integration check.

Reference the schema from an extension manifest with:

```json
{
  "$schema": "../../schemas/winkgo-extension-v1.json",
  "name": "my-extension",
  "version": "1.0.0"
}
```

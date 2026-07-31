# WINK GO modifications

WINK GO reviewed this directory against Anthropic's pinned upstream
`skill-creator` source and made the following changes in 2026:

- `SKILL.md`: local integration wording and Windows/PowerShell compatibility
  guidance.
- `references/output-patterns.md`: local documentation adjustments.
- `scripts/quick_validate.py`: local validation behavior adjustments.
- `scripts/init_skill.py`: six upstream example lines were replaced with
  generic image/data examples so the generated template does not point to the
  removed PDF and DOCX examples.
- `LICENSE.txt`: synchronized to Anthropic's official complete Apache-2.0
  license text containing `Copyright 2026 Anthropic, PBC.`

The following files matched the content comparison baseline after normalizing
line endings and were not substantively modified:

- `references/workflows.md`
- `scripts/package_skill.py`

Modified source files carry a prominent modification notice. Future changes to
an upstream-derived file must update this record and preserve the Apache-2.0
license and attribution.

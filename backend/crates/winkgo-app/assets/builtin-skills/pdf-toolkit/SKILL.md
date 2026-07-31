---
name: pdf-toolkit
description: >-
  Work with PDF files locally: preview or open them, extract text and metadata,
  merge, split, rotate, encrypt or decrypt with authorized credentials, render
  pages to images, assess OCR needs, inspect form limitations, and validate
  results. Use for PDF inspection, conversion, organization, and
  privacy-conscious document workflows.
---

# PDF Toolkit

Handle PDFs locally and conservatively. Preserve the source file unless the
user explicitly requests an in-place change.

## Choose Existing Capabilities First

1. Use the host application's built-in file preview or inspection tools when
   they satisfy the request.
2. Probe installed tools before choosing a workflow (`Get-Command` on
   PowerShell, `command -v` on POSIX, then the tool's `--help` or `--version`).
3. Prefer a tool already present:
   - Poppler tools (`pdfinfo`, `pdftotext`, `pdftocairo`, `pdftoppm`) for
     inspection, text extraction, and page rendering.
   - `qpdf` for structural checks, page selection, merge/split/rotation, and
     password-based encryption changes.
   - `mutool` for inspection, extraction, rendering, or structural operations
     when available.
   - An already-installed Python library such as `pypdf` or PyMuPDF only when
     the local CLI tools do not cover the task.
4. Do not install a package, use a remote service, or add a project dependency
   without the user's approval. If no suitable local capability exists,
   explain the missing capability and offer a small, well-maintained option.

Verify command syntax against the installed version. Quote every path, use
absolute paths when practical, and never let an output path resolve to the
input path by accident.

## Inspect Before Changing

- Confirm the input exists, is a PDF, and is readable.
- Record page count, page sizes, rotation, encryption state, metadata, and
  whether the document has signatures, forms, attachments, outlines, or a text
  layer when those features could be affected.
- Treat an untrusted PDF as untrusted active content. Use a sandboxed or
  hardened local renderer; do not execute embedded JavaScript, launch actions,
  attachments, or links.
- Ask for the intended page order/ranges, output format, overwrite policy, and
  treatment of bookmarks/forms when the request is ambiguous.

Useful read-only probes, when installed:

```text
pdfinfo "input.pdf"
pdfinfo -meta "input.pdf"
qpdf --check "input.pdf"
qpdf --show-encryption "input.pdf"
```

## Preview or Open

Prefer the host previewer. For visual inspection, render only the needed pages
to temporary images rather than rewriting the PDF. Use the OS default viewer
only when the user asks to open the file or a host preview is unavailable.
Report the exact file opened and avoid opening an untrusted document in a
viewer that permits active content.

## Extract Text and Metadata

- Use normal text extraction first. Preserve layout only when the task needs
  columns or approximate positioning; reading order is often better without
  layout preservation.
- Distinguish document-info fields from XMP metadata and report which source
  was read. Metadata may contain author names, software, timestamps, paths, or
  other hidden information.
- Write extracted text to a new file for large documents; avoid dumping
  sensitive full text into chat or logs.
- A nearly empty extraction does not prove the document is empty. Check
  rendered pages to determine whether it is image-only, has an unusual text
  encoding, or restricts access.

Example when `pdftotext` is available:

```text
pdftotext -layout "input.pdf" "output.txt"
```

## Merge, Split, and Rotate

- Use a lossless structural tool when possible; do not rasterize pages merely
  to reorder or rotate them.
- Interpret user-facing page numbers as one-based, and translate carefully if
  a library uses zero-based indices.
- Use collision-safe output names for one-file-per-page splits.
- Preserve the original. Warn that outlines, named destinations, attachments,
  annotations, forms, and document-level metadata may not combine cleanly.
- Assume any content change invalidates existing digital signatures. Do not
  mutate a signed PDF unless the user explicitly accepts that consequence.

Common `qpdf` patterns, after checking the installed help:

```text
qpdf --empty --pages "a.pdf" "b.pdf" -- "merged.pdf"
qpdf "input.pdf" --pages . 1-5 -- "part.pdf"
qpdf "input.pdf" "rotated.pdf" --rotate=+90:1,3-5
```

Use `qpdf --split-pages` for a one-PDF-per-page result when that option is
available in the installed version.

## Encryption and Decryption

- Proceed only when the user is authorized and supplies the required password
  or certificate. Never guess, brute-force, crack, bypass, or remove a password
  or DRM restriction without valid credentials.
- Do not place passwords in source code, chat output, logs, or shell history.
  Prefer a native prompt or standard input. If the installed tool requires a
  password file, create it with restrictive permissions and remove it
  immediately after use.
- Keep decrypted temporary files local, minimize their lifetime, and clearly
  identify any unencrypted output.
- For new password encryption, prefer a currently supported strong algorithm
  such as AES-256 when the chosen tool and target readers support it. Verify the
  resulting encryption state.
- PDF permission flags are viewer-enforced preferences, not reliable DRM or
  access control. Do not promise that they prevent copying or printing.
- Certificate-encrypted documents require the matching private key and a
  capable trusted application. Stop if those are unavailable.

## Convert Pages to Images

Choose a page range, format, resolution, and color mode explicitly. PNG suits
text and line art; JPEG can reduce photographic output size but is lossy.
Rendering destroys searchable text, links, forms, vectors, and accessibility
structure in the image output.

Examples when Poppler tools are installed:

```text
pdftocairo -png -r 150 -f 1 -l 3 "input.pdf" "page"
pdftoppm -png -r 150 -f 1 -l 3 "input.pdf" "page"
```

Start with a modest resolution for previews and raise it only when the user
needs print quality or OCR. Estimate disk use before rendering many pages.

## OCR Boundary

OCR is a separate recognition step, not ordinary PDF text extraction.

- Use OCR only for scanned or image-only pages, after checking for an existing
  text layer.
- Prefer an already-installed local OCR engine such as OCRmyPDF/Tesseract.
  Confirm document languages before running it.
- Save OCR output as a new PDF. OCR can increase file size, alter compression,
  misread low-quality scans, handwriting, tables, columns, or uncommon fonts,
  and produce plausible but incorrect text.
- Do not apply forced OCR to a born-digital PDF without a specific reason; it
  can rasterize or degrade existing content.
- OCR cannot preserve a digital signature across a content change. Do not
  override signature safeguards silently.
- Validate recognized text against rendered samples, especially names,
  numbers, dates, and legal or financial content.

## Form Boundary

- Inspect fields before editing and distinguish standard AcroForm fields from
  XFA/dynamic forms.
- Many general-purpose PDF libraries have limited XFA support and may not
  regenerate field appearance streams consistently. Use a compatible trusted
  viewer for unsupported forms.
- Merging forms can create duplicate field names; filling or flattening can
  change calculations, validation, accessibility, or editability.
- Never use a generic PDF library to create a cryptographic signature or to
  overwrite an existing signature field. Signature workflows require explicit
  certificate handling and dedicated tooling.
- After any authorized form change, reopen the result in a second viewer and
  visually verify every affected field.

## Validate and Deliver

Before reporting success:

1. Require a successful tool exit status and confirm the output exists and is
   non-empty.
2. Run a structural check (`qpdf --check`, `pdfinfo`, or an equivalent already
   installed validator).
3. Recheck page count, page order, sizes, rotations, metadata, and encryption
   state relevant to the request.
4. Render and inspect the first, last, and every changed or boundary page.
5. Sample extracted/OCR text when text fidelity matters.
6. Report the exact output path, operations performed, validation completed,
   and any feature that could not be preserved.

Do not claim success from file creation alone.

## Privacy and Safety

- Keep sensitive documents and derivatives local. Never upload them to an
  unknown service. For any known remote service, obtain explicit consent and
  state the destination, purpose, and retention implications first.
- Minimize copied pages, extracted text, previews, and temporary artifacts.
  Remove temporary derivatives after validation unless the user requests them.
- Do not expose document contents, passwords, personal metadata, or file-system
  paths in logs beyond what is needed to diagnose an error.
- Respect copyright, access controls, retention rules, and the user's authority
  over the document.

## License

This original skill is distributed under the Apache License 2.0. See
`LICENSE`.

Copyright 2026 WINK GO contributors.

SPDX-License-Identifier: Apache-2.0

# Document thumbnails (library step 2, Quick Look)

Ian (2026-11-11): "Can you get thumbnails from the documents and PDFs?" He chose macOS Quick Look
(no new packages; Mac only, other systems keep icons) and no explainer. Branch: `library-index`,
local only.

## Facts established

- `qlmanage -t -s <px> -o <dir> <file>` writes `<dir>/<file name>.png`, fitting `<px>` on the long
  side, in about 0.2 s per file on the real brain. Tested on Skyseal reports: PDF, XLSX, CSV and HTML
  look right; Markdown comes out as small grey monospace text on dark stripes (poor).
- With `env -i` (empty environment) it still works.
- A probe HTML file with a remote `<img>`, a `<link>` stylesheet and a `<script>` that loads an image,
  all pointing at a local listener, produced a picture and **no request** reached the listener: Quick
  Look's HTML thumbnailer neither ran the script nor fetched anything.
- Today: `LibraryItem.thumb` is true only for images (`canThumb` in `server/brain/library.ts`);
  `createThumbnailer` (`server/brain/thumbs.ts`) refuses non-images; `Thumb.tsx` is image-only.

## Decisions

1. **Engine.** `/usr/bin/qlmanage`, used only when `process.platform === 'darwin'` and the binary is
   there (checked once at start). Elsewhere documents keep `thumb: false` and their icons.
   Plain: Macs show page previews; Windows later just shows icons, as today.
2. **Which files.** pdf, docx, xlsx, pptx, csv, html, htm, up to 50 MB (the image cap). Not md or txt:
   Quick Look draws them poorly; they keep their icons (a cover of our own is a later step).
   Plain: real documents get a preview; notes keep the clean icon.
3. **Safety.** Never hand Quick Look a path in the brain. Read the checked bytes (`readChecked`,
   same inode as listed), write them to a fresh private temp folder (`mkdtemp`, 0700) as
   `file.<ext>`, run `qlmanage` there with an empty environment, `cwd` the temp folder, no stdin,
   output ignored, killed at 15 s. Read `file.<ext>.png` (cap 32 MB), require PNG magic, then `sharp`
   re-encodes it to WebP at the asked width (as for images). The temp folder is always removed. One
   Quick Look at a time, inside the existing overall limit. A failure is remembered per version, as
   for images.
   Plain: Quick Look only ever sees a private copy, can't hang the app, and its output is redrawn.
4. **Contract.** `canThumb` gains the document case, gated on the platform flag (an option on
   `createLibrary`, defaulting to detection, so tests can force it either way). `LibraryItem.thumb`
   doc comment updated. Same routes, widths and cache.
5. **Screens (overseer and design expert decide).** Proposal:
   - Panel: the white cover card shows the page preview (320) above the title, flat on white with a
     hairline edge like an image; falls back to today's icon cover.
   - Sheet: add the Images-style Grid | List switch to Documents. Grid tiles show the page preview in a
     portrait box; List keeps today's rows (icon box), or a tiny preview in the 32px box.

## Tests (first, for the logic)

- `library.test.ts`: `thumb` true for a PDF/xlsx when the flag is on, false when off, false for md.
- `thumbs.test.ts`: with a fake `qlmanage` script (option `quickLook: path`) that writes a PNG, a
  document thumb is made, cached, re-made when the version changes; a fake that hangs is killed and
  remembered as failed; a fake that writes non-PNG is refused; the brain path is never passed
  (the fake records its argv); the temp folder is removed.
- Client: Documents panel shows the preview when `thumb`, the icon cover when not or on error; grid
  tiles if built.

## Review

Overseer pre-review, security expert, design expert on screenshots, correctness reviewer.

## Overseer pre-review outcomes (2026-11-11, Opus; Fable was at its limit)

- **Blocking, fixed in the plan:** a broken file makes Quick Look hang, not fail (re-checked: a 7-byte
  junk `file.pdf` was still running after 8 s). So: the limit is **5 s**, the child is started in its
  own process group and the whole group is killed; the first bytes are checked before Quick Look runs
  (`%PDF-` in the first 1 KB for pdf, `PK\x03\x04` for docx, xlsx, pptx) and a mismatch is refused
  without running it. One Quick Look at a time, taken before the shared slots, so a hung document
  never holds up an image.
- One detection (`quickLookAvailable()`), passed to both `createLibrary` and `createThumbnailer`.
- The thumbnailer option is `{ command, args }`, so tests run a Node script with `process.execPath`
  under an empty environment. Success only when a PNG is there.
- Documents are made at **320 only** (other widths answer 404); Quick Look draws at 480 (`-s`) so an
  A4 page is not too narrow.
- HTML re-probed with an iframe, `@import`, `@font-face`, meta refresh, prefetch, object, video,
  `fetch()` and a `file:///` image: no request reached the listener. DNS lookups were not watched
  (needs admin rights). A page that relies on remote CSS previews unstyled.
- `.img-thumb` and `.img-tile` move to shared `library.css` with a `--thumb-ratio`; `Thumb` takes an
  `icon`.
- **Types:** pdf, docx, xlsx, pptx, html, htm. **csv dropped** (908 in `clients/`, near-identical tiny
  tables; the sheet icon says more). md and txt stay out.

**Decision 5, decided:**
- Documents gets a Grid | List switch, last in the tools row (as Images). **Default List** (about half
  the documents are md or txt with no picture).
- Grid tile: the Images tile exactly (padding 8, radius 10, 2px gap, minmax 132px, tick on the
  corner), box **3:4** portrait, picture contained with a hairline edge, title 13/500 up to two lines,
  meta "PDF, 840 KB".
- List rows: unchanged (32px icon box; no Quick Look runs for the list).
- Panel: the picture in the Images panel's 3:2 box, then the title and file name; the format's icon
  stands in when there is no picture or it fails to load.

## Review outcomes (2026-11-11)

- **Security (Opus): blocking, confirmed and fixed.** Quick Look's HTML thumbnailer loads `file://`
  and relative addresses in iframes and images (no request ever reaches a listener, so the earlier
  network probe could not see it). A page in the brain could draw a local token or `.env` file into
  its picture. **html and htm are dropped**: `DOC_THUMB_EXTS` is pdf, docx, xlsx, pptx, and
  `looksLikeDocument` refuses anything else. A test proves a web page is never handed to Quick Look
  even if the list said yes. The preview's thumbnail cache was cleared. Nice (not done): a file
  rewritten with the same size and a kept modified time keeps its old picture (same file only).
  Follow-up probe (Darwin 27, Apple's own Office and PDF generators): docx altChunk (HTML and MHT),
  INCLUDETEXT/INCLUDEPICTURE fields, VML and pptx external images, a linked video, an xlsx
  externalLink, markup injection through run text, font names and hyperlinks, and PDF external
  streams, reference XObjects, Launch/GoToR and file attachments: none read another file or ran
  anything; only cached values are drawn. Not covered: DNS from the Office path, linked OLE objects,
  other macOS versions.
- **Design (Opus):** blocking, fixed: with two switches in the tools row, Sort floated mid-row (both
  had `margin-left: auto`). Should, fixed: the panel preview is square when there is a picture (a page
  shows at about twice the size). Should, done then withdrawn: trimming grey bands off web-page
  pictures, moot once web pages were dropped. Leave: icon tiles for CSV folders (house rule, list is
  the default). Should, fixed: design-system.md updated.
- **Correctness (Opus):** should, moot: the web-page trim cropped dark pages to a strip of text (the
  trim is gone with HTML). Consider, fixed: the "not a PNG" test passed with the PNG check removed;
  the fake now writes SVG markup under the PNG name, and the test fails without the check.

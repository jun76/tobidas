---
name: tobidas-create
description: Design a tobidas picture book from a prompt, prepare assets, build it in the standard builder through WebMCP or semantic UI, and verify the result. Use this for creating new tobidas works or reproducing a production workflow from a design document.
metadata:
  short-description: Design, build, and verify tobidas picture books
---

# tobidas-create

Turn a user's prompt into a picture-book project that can be played in tobidas.

Keep picture-book production separate from changes to tobidas itself.
For requests that change the core source, save format, build, or deployment, read the repository's `AGENTS_DEV.md` before starting.
For picture-book production only, read `AGENTS.md` and [references/design-sheet.md](references/design-sheet.md).
Do not automatically change the core application, deploy, push to GitHub, or create tags during picture-book production.

## Scope

The default deliverable is a standalone work saved where the user requests.
Only change `scripts/samples/`, `projects/`, or the catalog when the user explicitly asks to add a public sample to the repository.
Do not edit generated `projects/*/project.json` files directly; update the public-sample definitions and assets, then regenerate them.

## Start with the work's authoring guide

Before designing, generating assets, placing parts, or reviewing a work, read its editable **Authoring guide**.

- With WebMCP, call `tobidas-get-state`, then `tobidas-get-authoring-guide`.
- Without WebMCP, read the standard builder's **Authoring guide** pane below the Inspector.
- Treat the guide stored in the current work as the source of truth for creative defaults and constraints.
- Do not recreate old defaults in this skill, a design sheet, or a prompt.
- Change the guide only when the user explicitly requests a change, using the standard UI or `tobidas-update-authoring-guide`.

## Design sheet

In the first response after receiving an initial prompt, do not begin asset generation or save a work; draft the design sheet using [references/design-sheet.md](references/design-sheet.md).
Ask only questions whose answers would materially change the design. Mark unresolved decisions and ask for confirmation before asset generation or placement.
Keep the design sheet consistent with the current work's authoring guide. The guide supplies defaults; the sheet records the decisions for this work.

The sheet should cover the title and slug, reader and language, synopsis, spread-by-spread scene and text, asset roles, camera and sound intent, and verification risks.
Treat the cover exterior, cover interior, and back cover separately when the book structure requires it.
After confirmation, save the sheet as `design.md` in the work folder.

## Production workflow

After design approval:

1. Expand the sheet into an asset list and separate prompts by asset role.
2. Generate or obtain the required images, video, and audio. Check transparency, dimensions, aspect ratios, margins, size, and unintended duplication.
3. Start the development server when working from a clone, then import assets together through the standard Assets panel.
4. Select the target spread in the BOOK navigator before placing parts.
5. Use page-background assignment for full-page artwork and visual-part presets for separate pop-up parts. Use the standard built-in page-turn audio; do not copy a page-turn file into the skill or work merely to replace that built-in asset.
6. Configure text, camera, lights, motion, timeline keys, BGM, and sound cues through the standard inspector and timeline, or through WebMCP when available.
7. Save or export to the requested location.
8. Read [references/verification.md](references/verification.md) and run the applicable checks.

When WebMCP is available, call `tobidas-get-state` first and use stable IDs. Read the authoring guide before planning or editing, and confirm later changes through tool results and state.
When WebMCP is unavailable, use the standard builder's semantic DOM, ARIA labels, and detail actions. Upload assets through the standard panel and use the visible UI for file permissions and saving.
Read operation results from `data-tobidas-kind="operation-result"`. Do not pass asset binaries, data URLs, Blob objects, or IndexedDB internals through WebMCP.

## Repository samples

For a public sample, write structure in `scripts/samples/<work>.mjs`, assets in `scripts/samples/assets/<work>/`, and register the work in `scripts/generate-samples.mjs`.
Use the repository's shared sample helpers and overrides. After changes, run:

```bash
npm run samples:generate
npm run samples:check
```

Do not make generated `project.json` pass by editing it directly.

## Completion report

Report the work folder, design sheet, asset count, spread count, verification results, and unresolved constraints.
Clearly label estimates left in the design sheet. Do not report playback, transitions, audio, cover, builder operations, or WebMCP operations as verified unless they were checked.

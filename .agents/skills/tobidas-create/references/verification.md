# Verify the completed work

Use the work's Authoring guide as the source for creative and visual acceptance criteria.
This reference lists the technical checks and the inspection order; it does not duplicate the guide's production rules.

## Mechanical checks

For a public sample in the repository, run:

```powershell
npm run samples:generate
npm run samples:check
npm run qa:semantic
npm run qa:holds -- <sample-id> --out shots/<sample-id>-holds --phases 0,0.5,1 --turns
```

For a standalone work, use the repository's verification scripts with the absolute work-folder path.
To inspect one hold time:

```powershell
node scripts/screenshot.mjs --project projects/<sample-id> --scroll 0.5 --out shots/<sample-id>-mid.png
node scripts/verify-stow-layout.mjs projects/<sample-id> --strict
```

The stow-layout check is structural. It does not decide whether a composition is attractive or whether an image contains the intended subject.
Use a temporary QA workspace for repository-dependent checks when the work is not a public sample.

## Asset checks

Confirm the format, transparency, dimensions, aspect ratio, margins, and file size of every imported asset.
Confirm that each referenced asset exists and that sound files satisfy the repository limits.
New works already contain the builder's standard cover, BGM, and page-turn assets; use those built-ins where the authoring guide calls for them.

## Visual playback inspection

Use the standard builder's playback and Browser／Computer Use screenshots at representative hold positions and page-transition positions.
Compare the result with the work's design sheet and authoring guide.
Check:

- text and important parts remain visible and within their intended page;
- page backgrounds and separate pop-up parts retain their intended roles;
- fold, depth, overlap, clipping, and stowing behave as intended;
- camera, light, motion, BGM, and sound cues support the scene;
- the opening, middle, and closing states are all understandable.

Do not claim a visual or playback check was completed without inspecting the corresponding screenshots or playback.

## Standard-builder and WebMCP checks

Confirm that the work can be opened, edited, saved, and replayed in the standard builder.
Assets are imported through the standard Assets panel.
When WebMCP is available:

- call `tobidas-get-state`, then `tobidas-get-authoring-guide` before planning;
- use stable IDs and confirm tool results in the same work;
- confirm that `tobidas-update-authoring-guide` changes the work and participates in undo/autosave;
- confirm that page-background assignment is used for full-page artwork;
- confirm that structural tools and the standard UI show the same result.

When WebMCP is unavailable, use semantic DOM, ARIA, and detail actions. The absence of WebMCP must not change the work data or the verification criteria.

On failure, isolate the cause in the design sheet, authoring guide, assets, generation definition, or placement values and fix that source. Do not directly edit a generated `project.json`.

# Verify the completed work

Divide verification into mechanical checks of generated output, visual inspection of playback, and AI-mode operation checks.

## Mechanical checks

For a public sample in the repository, run the following from the repository root.

```powershell
npm run samples:generate
npm run samples:check
node scripts/verify-builder-ai-mode.mjs
npm run qa:holds -- <sample-id> --out shots/<sample-id>-holds --phases 0,0.5,1 --turns
```

Use the following to run the checks together through the bundled runner.

```powershell
node <skill-dir>/scripts/run-repo-qa.mjs --repo <repo-root> --project <sample-id> --out shots/<sample-id>-holds --phases 0,0.5,1
```

Use the following to inspect one hold time.

```powershell
node scripts/screenshot.mjs --project projects/<sample-id> --scroll 0.5 --out shots/<sample-id>-mid.png
```

Run the following to mechanically check background-panel stowing order and initial placement.

```powershell
node scripts/verify-stow-layout.mjs projects/<sample-id> --strict
```

Without `--strict`, the command lists warnings and errors without stopping existing works.
Background panels are detected from terms such as `backdrop` or `background` in their names or asset IDs.
The check verifies the earliest `stow.stagger`, an initial Y that rises above the background board, and an initial Z that goes behind it.

For a standalone work, pass the absolute path of the work folder to `--project` to check the same playback path.
The bundled runner calls the repository's existing `screenshot.mjs` for each hold time.
When a repository-dependent check is needed, use a temporary QA workspace instead of moving the work into the public samples.

## Asset checks

- Images are WebP.
- 3D parts have transparent backgrounds with no checkerboard or white fill left behind.
- Large transparent margins have been removed.
- Ground images do not contain prominent buildings, people, tools, or other subjects.
- Spatial backgrounds are pale and do not compete with the same subject as a 3D part.
- Character and animal art does not reuse the same image file across spreads, except for user-requested exceptions.
- Each audio file is no larger than 3 MB.
- The builder's preloaded `standard/page-turn.wav` asset is assigned to every story-spread transition except after the final spread, with no duplicate imported page-turn asset.

## Visual playback inspection

Take screenshots at hold times `0`, `0.5`, and `1`, and at the midpoint of every page transition.
Check the following for every spread.

- Text is not clipped by a page edge.
- Body text is visible at the beginning, middle, and end of the hold and remains fixed as printing on its owning page.
- At the midpoint of a page transition, body text folds with the page and neither flies into the air nor disappears through a fade or visibility change.
- Body-text elements have no motion, particle, opacity, or visibility directing tracks.
- Body-text parent, layer, rotation, pivot, opacity, motion, clock, font, and particle settings match the shared `caption` implementation.
- Parts never pass through an adjacent page, even briefly.
- Parts do not overlap unintentionally.
- The visual roles of ground, spatial background, and 3D parts are distinct.
- Background panels do not rise later than other standing parts during unfolding.
- Other parts do not start above the background panel's lower edge or behind the panel.
- Large parts near the center fold are not arranged in a way that makes folding difficult.
- Camera movement and lighting do not lose the subject.
- Hold-time motion does not move parts outside the paper.
- Sound effects match scene changes and do not play while stopped or during reverse playback.

## AI-mode operation checks

- A new work can be created and switched to AI mode.
- Assets can be imported in one batch.
- JSON from `data-tobidas-kind="ai-state"` exposes the work's `book`, spreads, elements, timeline, selection, and verification results.
- Adding, duplicating, moving forward or backward, and deleting spreads is reflected in AI-mode operation results.
- After selecting a spread in the tree, parts can be placed only on that target spread.
- Names, positions, dimensions, layers, and visibility can be updated after placement.
- Updates can be confirmed without submitting invalid step values.
- Keys can be added to the AI-mode spread hold timeline by specifying the target, property, time, and value.
- Keys can be played and scrubbed, and their time and interpolation can be changed; keys and tracks can be deleted.
- Position, rotation, scale, visibility, opacity, image switching, environment, camera, and audio-cue direction are saved to the same work data as standard mode.
- Every editing field for the cover, pages, spreads, BOOK, lights, and parts that exists in standard mode can be reached from AI mode.
- After an operation, success or failure and the verification count can be read from `data-tobidas-kind="ai-operation-result"`.
- Timeline tracks and keys can be identified by `data-tobidas-kind="timeline-track"` / `timeline-key` and saved IDs.
- Editing operations are disabled during playback.
- The work is preserved after returning to standard mode.

On failure, isolate the cause in the design, assets, generation definition, or placement values and regenerate; do not directly edit the generated `project.json`.

---
name: tobidas-create
description: Design a tobidas picture book from a prompt, generate assets, build it in AI mode, configure its direction, and verify the result. Use this for creating new tobidas works or reproducing a production workflow from a design document.
metadata:
  short-description: Design, build, and verify tobidas picture books
---

# tobidas-create

Turn a user's initial prompt into a picture-book project that can be played in tobidas.

Keep picture-book production separate from changes to tobidas itself.
For requests that change the core source, save format, build, or deployment, read the repository's `AGENTS_DEV.md` before starting.
For picture-book production only, read `AGENTS.md` and the materials for this skill.
Do not automatically change the core application, deploy, push to GitHub, or create tags during picture-book production.

## Scope of work

The default deliverable is a standalone work saved in the user's Documents folder.
Only change `scripts/samples/`, `projects/`, or the catalog when the user explicitly asks to add a public sample to the repository.
Do not edit generated `projects/*/project.json` files directly; update the public-sample definitions and assets, then regenerate them.

## Create the design sheet first

In the first response after receiving an initial prompt, do not begin asset generation or save a work; draft the design sheet instead.
Use the template at [references/design-sheet.md](references/design-sheet.md).

The design sheet must include the following:

- Work title: write it in English.
- Project folder name: derive an English kebab-case slug from the title.
- Language of in-story text: use English unless specified otherwise.
- Synopsis: invent one from the initial prompt alone unless specified otherwise.
- Image style: use a hand-drawn picture-book style unless specified otherwise.
- Page count: use five story spreads unless specified otherwise.
- Parts per spread: use at least four parts including the ground background unless specified otherwise.
- Save path: use `tobidas/projects/<slug>` under the user's Documents folder unless specified otherwise.

Ask additional questions only about information missing from the initial prompt that affects the design.
Apply defaults to the seven items above, label them as "estimated" or "default" in the draft, and ask for confirmation.
Ask whether it is acceptable to proceed with the defaults together with any answers to the additional questions.
When the user says to proceed as-is, confirm the defaults.
Do not stop production to ask about preferences that do not affect the design.

Treat the page count as the number of story spreads excluding the cover.
Prepare the cover exterior, cover interior, and back cover separately.
Each spread's design table must record the scene, in-story text, ground, pale spatial background, 3D parts, camera, lights, sound effects, color palette, and verification risks.

## Separate asset roles

Spread page images should, in principle, be limited to the ground surface.
Do not draw content that can become 3D parts—such as mountains, houses, castles, bridges, trees, people, or tools—into a spread image.
Faint ridgelines, haze, and distant tree silhouettes are allowed when they do not compete with 3D parts.

Prepare one spatial-background image separately from the ground image for each spread.
The spatial background should be a pale distant view that communicates depth without making a major building or person the subject.
After generation, check that objects intended to become 3D parts are not also drawn prominently in the spatial background.

Place at least four parts on every spread, including the ground background.
Place at least three 3D parts besides the ground to explain the scene.
Choose 3D parts from people, buildings, animals, tools, plants, and light fragments, and do not duplicate the same image as both background and 3D part.
Do not crowd large parts near the center fold or place them where they cross the opposite page when the book closes.

### Background-panel rise order and initial placement

Include a background-identifying word such as `backdrop` or `background` in the part name or asset ID of a background panel.
Treat the background panel as a large standing board and set `stow.stagger` to `0` so it does not rise later than other parts.

After placing a background panel, follow these initial-placement rules:

- Do not raise the foot of a part that overlaps the background panel horizontally above the panel's lower edge. Record intentional exceptions such as floating parts in the design sheet.
- Do not place a part farther back than, or at the same depth as, the background panel. Put the background panel at the back and 3D parts in front so the rising panel does not step on them.
- When using multiple background panels, treat them as one background group and do not count the panels against one another as violations.

After placement, run `node scripts/verify-stow-layout.mjs <work-folder> --strict` and visually check screenshots at hold times `0`, `0.5`, and `1`, plus the midpoint of each page transition, to ensure the background board does not pass through other parts.

### Make character art unique per spread

Do not reuse the same character or animal image file unchanged across multiple spreads.
When the same character returns, generate a separate asset for each spread and change at least one of the pose, expression, clothing state, held object, or lighting to match the scene.
Preserve the art style, body proportions, and character identity with reference images, but do not settle for a copy, a differently cropped version, or the same atlas frame.
Create a mapping of spread ID, character/animal ID, and unique filename in the asset list, and confirm before placement that character and animal filenames do not repeat across spreads.
Allow an exception only when the user explicitly requests reuse of the same character art, and record that request in the design sheet.

### Fix body text to the page

Treat in-story text, captions, and dialogue on a spread as body text printed on its owning page, not as floating decorative or directing parts.

Use the body-text settings from existing samples as the baseline and follow the `caption` helper in `scripts/samples/shared.mjs`.
The body-text defaults are: set the owning page as `parent`; `layer: 9`; `rotation: [-90, 0, 0]`; `pivot: [0.5, 0.5]`; `scale: [1, 1, 1]`; `opacity: 1`; `visible: true`; `motion: []`; `clock: "visible-elapsed"`; transparent background; `font: "rounded"`; bold; particles disabled; and no timeline for the text element.
Choose the body-text position in the same page coordinates as `caption`, using `v: 0.92` as the baseline and adjusting only `u`, `size`, and color for the amount of text.
Let the `caption` helper derive `width`, `height`, and `fontSize` from the string; do not calculate separate dimensions by hand.

- Always make a body-text element a child of the left or right page and attach it to the page surface. It folds with its parent page and does not leave the paper during a page turn.
- Do not assign `Content Motion`, `Resident Time`, particles, blinking, scaling, rotation, `fadeIn`, `fadeOut`, or opacity/visibility timeline tracks to body text.
- Keep body text visible at the beginning, middle, and end of the hold. Do not hide it immediately before a page turn or only during the transition to conceal floating or popping.
- Do not create a branch for cases where body text cannot be fixed to the page. Use the shared `caption` settings and avoid floating or popping by changing the settings.
- In screenshots at the midpoint of a page transition, confirm that body text remains on the paper, moves in the same direction as the page, and does not fly into the air.

Check the alpha channel of generated cutout assets mechanically.
Do not use assets with a checkerboard or white background baked into the image.
Trim transparent margins and save images as WebP.
Follow the size and total-work limits in `AGENTS.md`.

## Use sound and direction

Use the builder's preloaded standard audio asset `standard/page-turn.wav` for page turns.
Do not copy or import a separate page-turn file into the work.
Keep the standard asset assigned to every spread that transitions to another story spread, and leave it unassigned after the final spread.

Actively prepare sound effects for scene changes, entrances, magic, footsteps, water, wind, and sparkles when they fit the story.
Use an audio-generation capability when available; otherwise generate short effects with [scripts/synthesize-sfx.mjs](scripts/synthesize-sfx.mjs).
Place sound effects as cues at times that match each spread's direction.
Do not repeat the same sound across every page without a story reason.
Keep each audio file within 3 MB and the total work within repository limits.

Use settings that are easy for the user to remove from the start.
Configure the cover color, paper color, light position, light color, camera position, camera distance, resident motion, hold-time camera movement, and sound effects according to each scene's role.
Do not add direction merely to increase the number of effects; every effect should support the reader's focus, a scene change, or a sense of depth.

## Production after design approval

After the design sheet is confirmed, work in this order:

1. Create the save path and save the design sheet as `design.md`.
2. Expand the design table into an asset list containing the cover, spread grounds, spatial backgrounds, 3D parts, and sound effects.
3. In image generation, keep the overall style, scale, colors, and light direction consistent, and generate grounds, spatial backgrounds, and 3D parts with separate prompts. Assign a unique prompt and filename to each character or animal illustration on each spread.
4. Check asset transparency, dimensions, aspect ratios, size, margins, and cross-spread duplication of character and animal art.
5. Start the development server and import the assets together in AI mode.
6. In AI mode, select the target spread in the tree before placing parts.
7. Place the ground, background panel, spatial background, 3D parts, text, and particles for each spread. Set `stow.stagger: 0` on the background panel, then keep other parts no higher than the panel's lower edge and in front of the background. Update names, positions, dimensions, layers, and visibility. Fix body text to its owning page and do not add a directing track to text elements.
8. In AI mode, configure the cover, camera, lights, resident motion, authored timeline, and audio cues in the same project data as standard mode. Add, duplicate, and reorder spreads with spread operations. Add keys by explicitly specifying the target, property, time, and value. Use the timeline below the viewport to check playback, scrubbing, interpolation, time changes, and deletion.
9. After saving or exporting, place the completed work package in the requested save path.
10. Read [references/verification.md](references/verification.md) and run the existing tobidas checks from [scripts/run-repo-qa.mjs](scripts/run-repo-qa.mjs).

For AI-mode inputs, obey the `min`, `max`, and `step` displayed on the screen.
When locating AI-mode targets, use `data-tobidas-kind` and `data-tobidas-id` on the target tree.
The current `data-tobidas-kind="ai-state"` contains JSON for the `book`, spread list, all elements, all timeline keys, selection, and verification results, excluding the asset bodies.
Fetch this JSON first, fetch it again after screen operations, and confirm changes by comparing IDs and values.
After finalizing the background-panel name and placement, run `scripts/verify-stow-layout.mjs` with `--strict`.
Do not submit initial values unchanged; enter values that satisfy the form constraints before updating.
Confirm after placement that the selected spread and direct-placement target match by checking the selected part name and spread name.
If verification fails, return to the design or definition and fix the cause.

## When creating a public sample

Switch to the repository's production rules only when the user explicitly asks to add a public sample.
Write the structure in `scripts/samples/<work>.mjs`, put assets in `scripts/samples/assets/<work>/`, and register the work in `scripts/generate-samples.mjs`.
Preserve the roles of ground image, spatial background, and 3D parts in the generated definition.
After generation, run `npm run samples:generate`, `npm run samples:check`, and QA for holds and page transitions.
Do not make only the generated `project.json` pass verification by editing it directly.

## Completion report

At completion, report the work folder, design sheet, asset count, spread count, verification results, and unresolved constraints.
Clearly label any estimates left in the design sheet as estimates.
Do not report hold times, page transitions, audio, cover, or AI-mode operations as verified if they were not checked.

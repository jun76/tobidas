# Design sheet format

In `design.md`, record decisions derived from the initial prompt separately from items that require user confirmation.
Confirm unresolved items before proceeding to asset generation or placement.

## Opening metadata

```yaml
title: "English title"
slug: "english-kebab-case-slug"
text_language: "English"
story_spreads: 5
parts_per_spread: 4
visual_style: "hand-drawn picture-book"
text_treatment: "fixed page-printed (shared caption settings)"
character_asset_policy: "unique-per-spread"
save_path: "<Documents>/tobidas/projects/<slug>"
status: "draft"
```

`story_spreads` is the number of story spreads excluding the cover.
`parts_per_spread` is the minimum number including the ground background; do not set it below the number of parts the scene requires.

## Confirmation items

```markdown
## Estimated items

- Title: ...
- Text language: ...
- Image style: ...
- Number of spreads: ...
- Save path: ...

## Additional questions

1. Reader age and whether the work is intended for reading aloud: if unspecified, may it target preschool through early elementary readers?
2. Constraints on tone or ending: if unspecified, may it have a reassuring ending?
3. Specific character settings, content to avoid, or constraints on audio and sound effects: apply any that are provided.

May I proceed with the estimates and defaults above?
```

Do not stop at questions for items that defaults can resolve; put values in the draft and ask for confirmation.
When the user accepts the defaults, change the metadata to `status: confirmed`.

## Spread table

Create the following table for every spread.

| Item | Content |
| --- | --- |
| Scene | What happens on the spread |
| In-story text | Short body text in the chosen language |
| Body-text treatment | Shared `caption` settings (owning page, layer 9, baseline v 0.92). No direction during holds or page transitions |
| Spread ground | Ground, floor, water surface, path, and similar surfaces. Do not draw major buildings or people |
| Spatial background | A pale distant view separate from the ground. Do not feature the same subject as the 3D parts |
| Background-panel rise order | Background-panel part name and asset ID; `stow.stagger: 0` |
| Initial placement of each part | Keep parts no higher than the background panel's lower edge and at a `z` in front of the panel. Record the reason for intentional floating parts |
| 3D parts | At least three besides the ground, such as people, buildings, animals, and tools |
| Camera | Camera distance during the hold, guidance of the reader's gaze, and relationship to page transitions |
| Lights | Position, color, intensity, and time of day for the scene |
| Sound effects | Type of sound, trigger condition, and time |
| Color palette | Paper, cover, text, and light colors |
| Verification risks | Center fold, adjacent pages, background-panel intersections, initial vertical/depth relationships, overlap, clipping, and duplicate sounds |

## Divide asset prompts by role

Divide image-generation instructions into these four types:

1. Cover: generate it without text when the title will be baked in during post-processing.
2. Spread ground: limit it to subtle texture and surface-contact treatment.
3. Spatial background: limit it to a low-contrast distant view and do not draw the subject of a 3D part.
4. 3D parts: specify a transparent background, a ground-contact line, an isolated silhouette, and no unwanted checkerboard.

Do not draw the same building or person in more than one of the ground, spatial background, and 3D parts.
Use a separate asset and filename for character and animal art on each spread; do not reuse the same illustration across pages.
For returning characters and animals, create scene-specific new art while preserving the same art style and character design.
After generation, display the asset list and confirm that the story's subject has not slipped into a background.

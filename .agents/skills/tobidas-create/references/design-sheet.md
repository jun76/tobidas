# Design sheet format

Use the work's **Authoring guide** as the source of defaults and production constraints.
This document defines only the record format; it does not prescribe a title language, spread count, art style, part count, or asset-reuse policy.

In `design.md`, separate decisions derived from the user's prompt, decisions read from the authoring guide, and items that require confirmation.
Confirm unresolved items before asset generation or placement.

## Opening metadata

```yaml
title: "<title>"
slug: "<kebab-case-slug>"
text_language: "<language>"
story_spreads: "<count or guide value>"
save_path: "<requested path>"
status: "draft"
```

Record the source of each default when it matters:

```markdown
## Guide-derived decisions

- [guide key] ...

## User decisions

- ...

## Open questions

1. ...

May I proceed with the decisions above?
```

## Spread table

Create one row or section for every spread.

| Item | Content |
| --- | --- |
| Scene | What happens on the spread |
| In-story text | Text and its language |
| Ground and page background | Which image is assigned to the page surface |
| Spatial background | Any separate depth/background asset |
| Parts | Asset, role, parent, placement, and layer |
| Camera and lights | Intended view and lighting |
| Sound | BGM, page-turn, cues, and timing |
| Palette and style | Decisions that apply to this spread |
| Verification risks | Structural and visual risks |

Treat cover exterior, cover interior, and back cover separately when they exist.
Record asset IDs and filenames so that placement can be reproduced.

## Asset list

For each asset, record:

| Asset | Role | Filename or ID | Source | Transparency/format check | Used by |
| --- | --- | --- | --- | --- | --- |
| ... | ... | ... | ... | ... | ... |

Keep prompts and files separated by their intended role. Check generated assets before importing them into the builder.

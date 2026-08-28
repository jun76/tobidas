# tobidas

<p align="center">
  <img src="./.github/assets/tobidas.png" alt="The tobidas pop-up book builder interface">
</p>

<p align="center"><strong>Build and publish interactive web stories that unfold like pop-up books.</strong></p>

<p align="center">
  <a href="https://tobidas.9rsgy78c9c.workers.dev/">Open the online builder</a>
  ·
  <a href="./README.md">日本語</a>
</p>

<p align="center">
  <img alt="Release: 0.1.3" src="https://img.shields.io/badge/Release-0.1.3-5a68d8">
  <img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache--2.0-blue">
  <img alt="Local-first" src="https://img.shields.io/badge/Data-local--first-brightgreen">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61dafb">
</p>

## What is tobidas?

tobidas is a local-first browser builder for creating and playing landscape-oriented, pop-up-book-style web stories.
You author each spread in its fully open state; tobidas derives how its pages and paper elements fold while the book opens and closes.

You can start immediately at [tobidas.9rsgy78c9c.workers.dev](https://tobidas.9rsgy78c9c.workers.dev/).
Project data and imported assets are processed in your browser and are not uploaded to the tobidas server.
You can also clone this repository and run it locally or deploy it to your own static host.

## Features

- Page glue, standing parts, and automatic V-folds for artwork crossing the spine
- Automatic outside routing for airborne parts inferred from their open pose
- Images, SVG, audio, web fonts, text, and particles placed on transparent planes
- Timeline control for transforms, opacity, visibility, assets, backgrounds, lights, and cameras
- Spread editing with 3D gizmos and property panels
- Background music and sound effects such as page turns
- Japanese and English UI
- State and direct controls for user-side browser-use AI
- Automatic browser-local saves
- Export as a single HTML file or a ZIP for static hosting

## Use the online builder

1. Open [tobidas.9rsgy78c9c.workers.dev](https://tobidas.9rsgy78c9c.workers.dev/) in Chrome or Edge.
2. Choose **New** to start a project, or **Open** to select an existing project folder.
3. Import assets, choose a preset, and place elements on a spread.
4. Use **Play** in the upper-right corner to preview the book and its animation.
5. Use **Save** for an editable project folder and **Export** for publishable files.

Desktop Chrome or Edge is recommended because folder access uses the File System Access API.

## Use with browser-use AI

Enable **AI mode** in the toolbar to expose the current project, spread, selected part, asset IDs, and validation results as semantic DOM.
AI mode switches to a dedicated workspace with a control pane on the left and a viewport on the right at roughly a 1:2 ratio.
The standard editing panes and timeline are not duplicated, so you can keep watching the viewport while browser-use AI selects and edits the project.

The control pane brings together a target tree with stable IDs, asset loading, direct image placement, text and particle creation, selected-part editing, undo and redo, playback, and validation results.
Images can be placed by page and normalized coordinates without dragging on the Canvas.
When page constraints correct a requested position or page assignment, the operation result exposes both the requested and accepted values.
Every control has a semantic name and role, so browser-use AI does not need to depend on visual order or CSS classes.

Append `?ai=1` to the URL when a browser-use AI should start with the mode enabled.
The mode does not add an AI service or external communication, so projects and assets remain in the browser.
Its enabled state and operation results are not stored in project data.

### Use WebMCP

When the browser exposes WebMCP, tobidas registers structured tools from the same AI mode.
WebMCP is an additional tool path, not a separate user-facing mode.

The tools accept stable target IDs, normalized coordinates, and typed timeline values directly.
Tool results include the committed target, any placement or layout corrections, and validation counts.
WebMCP does not upload asset binaries, fetch external URLs, delete content, save projects, or export files.
Continue to use the existing AI-mode file input to import assets.

WebMCP tools are not rendered in the AI-mode panel.
A WebMCP-capable AI or a Model Context Tool Inspector can discover them after opening the page.
To inspect them from the browser console, run:

```js
const context = document.modelContext ?? navigator.modelContext
const tools = context ? await context.getTools() : []
tools.map((tool) => tool.name)
```

#### Browser compatibility

The following results were measured on August 26, 2026 by opening `http://localhost:5174/?ai=1` from each local browser executable.
Chrome and Edge were launched with `--enable-experimental-web-platform-features --enable-blink-features=WebMCP` for the experimental run.
Firefox was checked both with its normal settings and through a Firefox WebDriver BiDi path with its WebMCP testing preferences enabled.

| Browser | Normal launch | WebMCP-enabled launch | Observed result |
| --- | --- | --- | --- |
| Chrome 151.0.7922.170 | No `modelContext` | `modelContext` available | Discovered 20 tools; `get-state` and `create-visual` executed successfully |
| Edge 151.0.4129.107 | No `modelContext` | `modelContext` available | Discovered 20 tools; `get-state` and `create-visual` executed successfully |
| Firefox 154.0.1 | No `modelContext` | `--pref dom.modelcontext.enabled=true --pref dom.modelcontext.testing.enabled=true` | Discovered 19 imperative tools through `navigator.modelContext`; `get-state` and `create-visual` executed successfully. `document.modelContext` remains unavailable |

Chrome and Edge can also enable WebMCP by turning on **WebMCP for testing** at `chrome://flags/#enable-webmcp-testing` or `edge://flags/#enable-webmcp-testing` and restarting the browser.
For an Origin Trial, configure a valid WebMCP token for the target origin.
Firefox's `dom.modelcontext.*` preferences are experimental testing controls.
The measured Firefox implementation exposes the older `navigator.modelContext` surface; do not assume that normal Firefox launches it or that declarative form tools are exposed in the same way.
See the [WebMCP implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md) for the broader browser status.

When WebMCP is unavailable, the AI mode continues to use its semantic DOM, ARIA, and form controls.
Availability depends on the browser, experimental flags or Origin Trial, and the AI client that opens the page.

#### Available tools

When WebMCP is available, tobidas registers these imperative tools while AI mode is visible:

| Group | Tool | Purpose |
| --- | --- | --- |
| Read | `tobidas-get-state` | Read the current tobidas project state without asset binary data. Use this first to obtain stable spread and element IDs; scope defaults to full and can be active-spread or selection. |
| Read | `tobidas-get-spread` | Read one spread including its pages, elements, and timeline. Pass a spreadId returned by tobidas-get-state. |
| Read | `tobidas-get-element` | Read one element using its stable spread and element IDs. Pass IDs returned by tobidas-get-state or tobidas-get-spread. |
| Read | `tobidas-list-assets` | List imported asset metadata and references for later placement or BGM assignment; never returns binary asset data or uploads files. |
| Read | `tobidas-validate-book` | Read the latest tobidas validation errors and warnings. An optional spreadId limits the returned spread context. |
| Session | `tobidas-select-target` | Select a book, light, cover, spread, page, or element for human-visible supervision. Use the corresponding ID fields for spread, page, and element targets. |
| Session | `tobidas-set-preview` | Move the visible preview to a normalized book progress or a spread hold time. Provide progress, or provide spreadId with seconds within that spread hold interval. |
| Session | `tobidas-enter-play` | Enter playback mode so the person can inspect the book. This changes only the visible editing session. |
| Session | `tobidas-enter-edit` | Return to edit mode so structured book changes can be made. This changes only the visible editing session. |
| Edit | `tobidas-place-asset` | Place an already imported image, SVG, or video with a tobidas visual preset and normalized page coordinates. The asset must already be imported through the AI-mode file input; placement is committed through normal validation and undo history. |
| Edit | `tobidas-create-visual` | Create a text or light-particle visual using an existing tobidas preset. The new element is committed through normal layout validation and undo history. |
| Edit | `tobidas-update-element` | Update one tobidas element through layout normalization and validation. The input is a full typed update, not an arbitrary JSON patch; omitted fields keep their current values. |
| Edit | `tobidas-move-element` | Reparent one tobidas element to a page or another element while preserving normal constraints. The move is committed through the common edit, validation, and undo path. |
| Edit | `tobidas-add-timeline-key` | Add or replace one typed timeline key in a spread hold interval. The time and value are validated against the selected target property. |
| Edit | `tobidas-assign-bgm` | Assign one already imported audio asset as the project BGM. The audio must be imported through the AI-mode file input before this tool is called. |
| Edit | `tobidas-clear-bgm` | Clear the project BGM through the normal edit, validation, and undo path. |
| Edit | `tobidas-add-spread` | Add, duplicate, or move a spread through the normal edit and undo path. Deletion is not exposed by WebMCP. |
| Edit | `tobidas-undo` | Undo the last tobidas edit through the normal history. The result includes the current selection and preview state after undo. |
| Edit | `tobidas-redo` | Redo the last undone tobidas edit through the normal history. The result includes the current selection and preview state after redo. |

The asset placement form also carries `tobidas-place-asset-form` for declarative API testing.
It keeps the normal submit path and does not set `toolautosubmit`, so form automation does not skip user confirmation.

## Project folders

A project is a folder containing JSON data and its assets.

```text
my-book/
├─ project.json
└─ assets/
   ├─ page-left.png
   ├─ character.webp
   └─ page-turn.wav
```

Project-format compatibility is managed by the tobidas application release.

Two publishing formats are available:

- **Single HTML** — embeds every asset in one file that can be opened directly after download.
- **Static host** — packages `index.html` and `assets/` as a ZIP for services such as Cloudflare Pages.

## Sample projects

The `projects/` directory contains four ready-to-open samples:

- `forest_lantern` — Chasing the Forest Lantern
- `morning_walk` — The Walk to School
- `four_seasons` — One Window, Four Seasons
- `crooked_castle` — The Crooked Castle

Download or clone the repository, then select one of these folders with **Open** in the builder.
The samples and bundled assets have terms separate from the software license.
See the [Asset License](./ASSET_LICENSE.md).

## Run locally

Requirements:

- Node.js 20.19 or later, or 22.12 or later
- npm
- Desktop Chrome or Edge

```bash
git clone https://github.com/jun76/tobidas.git
cd tobidas
npm ci
npm run dev
```

Open `http://localhost:5174/`.

## Self-host

```bash
npm ci
npm run build
```

Deploy the generated `dist/` directory to any static host. For Cloudflare Pages:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | 22 or later |

The app expects to be served at the root of a domain. Hosting it below a subpath requires adjusting
`base` in `vite.config.ts` and the bundled-player URL.

## Development

```bash
npm run typecheck
npm test
npm run build
```

Agent instructions for creating books are in [AGENTS.md](./AGENTS.md).
Instructions for developing tobidas itself are in [AGENTS_DEV.md](./AGENTS_DEV.md).

## Privacy

tobidas is local-first. Projects, images, audio, and fonts are processed in the user's browser.
Automatic saves use IndexedDB. The hosted builder has no feature that uploads project data to its server.

## License

Software code and documentation text are licensed under the [Apache License 2.0](./LICENSE).

The sample projects under `projects/**`, bundled assets under `scripts/samples/assets/**`, the favicon,
and other visual or audio assets are not covered by Apache-2.0. They are governed by
[ASSET_LICENSE.md](./ASSET_LICENSE.md).

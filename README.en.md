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

WebMCP-capable browsers can discover the page tools as soon as the page loads, without a special query parameter.
Open the AI mode workspace from the same toolbar button when it is useful, including as the fallback in environments without WebMCP.
The **AI operation tips** badge distinguishes the public Origin Trial, browser-specific settings for Chrome, Edge, and Firefox, compatible AI clients, and the fallback path.
The mode does not add an AI service or external communication, so projects and assets remain in the browser.
Its enabled state and operation results are not stored in project data.

### Use WebMCP

When the browser exposes WebMCP, tobidas registers structured tools when the page starts.
WebMCP is an additional tool path, not a separate user-facing mode, and the AI mode workspace does not need to be open for tool discovery.

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

#### Access paths

| Where tobidas runs | Browser-side enablement | User action |
| --- | --- | --- |
| [Public web app](https://tobidas.9rsgy78c9c.workers.dev/) | Embed a WebMCP Origin Trial token issued for the target origin and browser in the served HTML | Chrome or Edge needs no setting when its matching token is embedded; Firefox uses its browser setting |
| Local clone | Enable the browser-specific WebMCP setting listed below in Chrome, Edge, or Firefox | Restart the browser and open `http://localhost:5174/` |
| Browser or AI environment without WebMCP | Do not use WebMCP | Use the same AI mode for the existing semantic DOM, ARIA, and form controls |

Enabling the browser API through an Origin Trial or browser-specific setting is separate from using an AI environment that can discover and call page-defined tools.
Both conditions are required for the structured WebMCP tools.
Support for listing and invoking page tools can vary with the AI client, its version, and the selected model.
The toolbar's **AI tools available** status means that the page registered its tools; it does not guarantee that the calling AI can retrieve them.
To verify the complete path, list the tools from the AI environment and call `tobidas-get-state` first.
The Chrome WebMCP Origin Trial covers Chrome 149 through 156 and is scheduled to end on November 17, 2026.
Use the [WebMCP Origin Trial registration page](https://developer.chrome.com/origintrials/#/register_trial/4163014905550602241) for the official deployment.

#### Browser compatibility

WebMCP availability differs by browser.

| Browser | WebMCP access path | Confirmed behavior |
| --- | --- | --- |
| Chrome | Origin Trial for the public app; Chrome setting for a local clone | 19 imperative tools; declarative form tools are available where the browser supports them |
| Edge | Edge Origin Trial or Edge setting | 19 imperative tools; declarative form tools are available where the browser supports them |
| Firefox | Enable `dom.modelcontext.enabled` and `dom.modelcontext.testing.enabled` in `about:config` | 19 imperative tools through `navigator.modelContext`; `document.modelContext` and declarative form tools are not confirmed |

For a local clone, enable the setting for the current browser and restart it. Chrome uses `chrome://flags/#enable-webmcp-testing`; Edge uses `edge://flags/#enable-webmcp-testing`.
The public web app embeds an Origin Trial token issued for its exact origin and browser provider, so matching Chrome or Edge users do not need to change browser settings. A token cannot be reused for another origin or browser provider.
Firefox's `dom.modelcontext.*` preferences are experimental testing controls. Firefox currently uses the older `navigator.modelContext` surface for imperative tools.
See the [WebMCP implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md) for the broader browser status.

When WebMCP is unavailable, the AI mode continues to use its semantic DOM, ARIA, and form controls.
Availability is determined by the combination of browser support or Origin Trial enablement and the calling AI's ability to list and invoke page tools.

#### Available tools

When WebMCP is available, tobidas registers these imperative tools when the page starts. AI mode does not need to be visible:

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

The repository also includes the [`tobidas-create` skill](./.agents/skills/tobidas-create/SKILL.md), which helps plan a book from a prompt, prepare assets, build it through AI mode, and verify the result. It can be used from Codex or another agent environment that supports repository skills.

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

For a public build that participates in the WebMCP Origin Trial, put the issued token in `.env.webmcp-public` and run `npm run build:public`.

```dotenv
WEBMCP_ORIGIN_TRIAL_TOKEN=Chrome_token_issued_for_this_origin
# Add only when also enrolling in the Edge Origin Trial
WEBMCP_EDGE_ORIGIN_TRIAL_TOKEN=Edge_token_issued_for_this_origin
```

`build:public` fails when the Chrome token is absent and validates its signature, origin, feature name, and expiry.
It also requires subdomain matching and third-party matching to be off, then injects the token as `<meta http-equiv="origin-trial">` in `dist/index.html`.
The token is a public value visible in served HTML, but it expires, so keep it in the build environment instead of fixing it in source.
The official deployment registers `https://tobidas.9rsgy78c9c.workers.dev`; another self-hosted origin needs its own registration and token.
The current Chrome trial is scheduled to end on November 17, 2026. Review any extension or stable release and update both the token and guidance before that date.

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

## FAQ

### Why can't I call WebMCP tools from gpt-5.6-luna in the Codex App?

This appears to be a model-specific limitation or integration issue in the Codex App's Browser path, rather than a tobidas tool-registration failure.
In the tested environment, the page-side WebMCP API and **AI tools available** status were active, but gpt-5.6-luna stopped while listing tools with `gpt-5.6-luna does not support command "webmcp_list_tools"`. On the same page and browser setup, gpt-5.6-sol and gpt-5.6-terra successfully listed the tools and called `tobidas-get-state`.

Because the error occurs inside the Codex App before `tobidas-get-state` is invoked, it does not indicate a failure in tobidas's WebMCP registration, Origin Trial token, or browser setting. OpenAI's public documentation does not explicitly state that gpt-5.6-luna is unsupported for the Codex App's `webmcp_list_tools` command, and no exact matching official issue has been identified. The official tracker does, however, contain open bug reports about [Browser plugin availability changing by model](https://github.com/openai/codex/issues/33592) and [missing tool injection for gpt-5.6-terra/luna](https://github.com/openai/codex/issues/33250).

For now, use gpt-5.6-sol or gpt-5.6-terra, or fall back to the same **AI mode** and its semantic DOM, ARIA, and form controls. AI-client and model support can change, so tobidas does not require a particular Codex model.

## Privacy

tobidas is local-first. Projects, images, audio, and fonts are processed in the user's browser.
Automatic saves use IndexedDB. The hosted builder has no feature that uploads project data to its server.

## License

Software code and documentation text are licensed under the [Apache License 2.0](./LICENSE).

The sample projects under `projects/**`, bundled assets under `scripts/samples/assets/**`, the favicon,
and other visual or audio assets are not covered by Apache-2.0. They are governed by
[ASSET_LICENSE.md](./ASSET_LICENSE.md).

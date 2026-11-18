# Graph for Vertex

A [Vertex](https://github.com/CTRL-Neo-Studios/vertex) plugin: your notes and the links between them as a graph, for
the whole workspace or around the note you're reading. A sample of the plugin API, built with
[`@type32/vertex-plugin`](https://www.npmjs.com/package/@type32/vertex-plugin).

- **Graph** (View → Open graph view): every note, each link an edge. Tags, attachments, links to notes that don't exist
  yet and notes with no links can each be shown or hidden.
- **Local graph** (in the right sidebar, or View → Open local graph): the notes within a few links of the open one.
- Hover a node to light up its neighbours, click it to open the note, drag nodes, scroll to zoom, drag the background
  to pan. Fit to view is in the view's header.
- It follows the workspace as you write: a link you add shows at once.
- Settings → Graph: the filters, colour groups (`path:Projects/ #f59e0b`, `tag:idea green`, or text in a note's name,
  then a colour) and the forces. Each can be set for one workspace only.

## Install

Settings → Plugins → Install…, and paste `https://github.com/CTRL-Neo-Studios/vertex-plugin-graph`.

## What it shows of the plugin API

| | Where | Docs |
| --- | --- | --- |
| Two panel views, both `tab: true`, each mounted with its own layout | `src/main.ts` | [`ctx.views.panel`](https://github.com/CTRL-Neo-Studios/vertex/blob/dev/packages/vertex-plugin/docs/context.md#ctxviewspanel) |
| Commands in the View menu and the palette, registered per session | `src/main.ts` | [`ctx.commands.register`](https://github.com/CTRL-Neo-Studios/vertex/blob/dev/packages/vertex-plugin/docs/context.md#ctxcommandsregister), [`ctx.onSession`](https://github.com/CTRL-Neo-Studios/vertex/blob/dev/packages/vertex-plugin/docs/context.md#ctxonsession) |
| The index, followed reactively; the shown tab; opening a note | `src/GraphView.vue` | [The index](https://github.com/CTRL-Neo-Studios/vertex/blob/dev/packages/vertex-plugin/docs/session.md#the-index), [`session.tabs`](https://github.com/CTRL-Neo-Studios/vertex/blob/dev/packages/vertex-plugin/docs/session.md#sessiontabsopen-sessiontabsclose-sessiontabsactive-sessiontabslist) |
| The theme on a canvas | `src/GraphView.vue` | [`ctx.ui.theme`](https://github.com/CTRL-Neo-Studios/vertex/blob/dev/packages/vertex-plugin/docs/context.md#ctxuithemedark-ctxuithemevalue) |
| A header button | `src/GraphView.vue` | [`ctx.views.panel`](https://github.com/CTRL-Neo-Studios/vertex/blob/dev/packages/vertex-plugin/docs/context.md#ctxviewspanel) |
| Settings from the manifest, overridable per workspace | `plugin.json` | [Config](https://github.com/CTRL-Neo-Studios/vertex/blob/dev/packages/vertex-plugin/docs/config.md) |
| Strings in two languages | `locales/` | [Strings](https://github.com/CTRL-Neo-Studios/vertex/blob/dev/packages/vertex-plugin/docs/package.md#strings) |
| Bundled dependencies (`d3-force`, `d3-zoom`, `d3-drag`) | `package.json` | [Dependencies](https://github.com/CTRL-Neo-Studios/vertex/blob/dev/packages/vertex-plugin/docs/package.md#dependencies) |
| A vault frontmatter helper from Vertex (`tagsOf`) | `src/GraphView.vue` | [The helpers](https://github.com/CTRL-Neo-Studios/vertex/blob/dev/packages/vertex-plugin/docs/package.md#what-the-plugin-shares-with-vertex) |

## Develop

```sh
bun install
bun test            # the graph's data: nodes, edges, filters, the local graph, colour groups
bun run typecheck
bun run build       # dist/ and plugin.zip
```

Install `dist/` in Vertex (Settings → Plugins → Install… ▾ → From a folder) and run `bunx vite build --watch`.
Releases: push a tag with `plugin.json`'s version (`v0.1.0`).

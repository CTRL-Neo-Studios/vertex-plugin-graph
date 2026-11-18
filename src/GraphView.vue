<script setup lang="ts">
import type {PanelViewProps, PluginContext} from '@type32/vertex-plugin'
import {tagsOf} from '@type32/vertex-plugin/vault'
import {drag} from 'd3-drag'
import {forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum} from 'd3-force'
import {select} from 'd3-selection'
import {zoom, type ZoomBehavior, type ZoomTransform, zoomIdentity} from 'd3-zoom'
import {computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, watchEffect} from 'vue'
import {buildGraph, type Graph, type GraphFile, type GraphNode, groupColor, neighbourhood, parseGroups} from './graph'

/** What the config holds (`plugin.json`'s schema). */
export interface GraphConfig {
    showTags: boolean
    showAttachments: boolean
    showUnresolved: boolean
    showOrphans: boolean
    localDepth: number
    groups: string[]
    centerForce: number
    repelForce: number
    linkForce: number
    linkDistance: number
}

const props = defineProps<PanelViewProps & { ctx: PluginContext<GraphConfig>, mode: 'global' | 'local' }>()
const {t} = props.ctx.i18n
const config = computed(() => props.ctx.config.value)

// The data. The index's entries are reactive (an entry's links follow an edit, its `modifiedTime` each save), so this
// follows the workspace; `unresolved` reads the link graph as it is, again on each save.
const files = computed<GraphFile[]>(() => props.session.index.files().filter(f => !f.isFolder).map(f => {
    void f.modifiedTime
    const ext = f.fileExt.toLowerCase()
    return {
        uuid: f.uuid,
        path: f.relativePath,
        name: ext ? f.fileName.slice(0, -(ext.length + 1)) : f.fileName,
        ext,
        links: f.forelinks,
        unresolved: config.value.showUnresolved ? props.session.index.unresolved(f.uuid) : [],
        tags: [...new Set([...tagsOf(f.properties), ...f.meta.tags.map(tag => tag.replace(/^#/, '').toLowerCase())])],
    }
}))
const whole = computed(() => buildGraph(files.value, config.value))

/**
 * The local graph's note: the shown tab's file; while another kind of tab is shown (this view's own, in a tab), the
 * note shown last, or after a relaunch, before any is shown, the first open file.
 */
const centre = ref<string>()
watchEffect(() => {
    const {tabs, index, editor} = props.session
    const active = tabs.active()
    const note = (active && index.byUuid(active) ? active : undefined)
        ?? editor.lastShownNote()
        ?? tabs.list().find(tab => !tab.kind && index.byUuid(tab.id))?.id
    if (note) centre.value = note
})
const graph = computed<Graph>(() => (props.mode === 'local'
    ? centre.value ? neighbourhood(whole.value, centre.value, config.value.localDepth) : {nodes: [], links: []}
    : whole.value))
const empty = computed(() => (!graph.value.nodes.length ? t(props.mode === 'local' && !centre.value ? 'plugins.graph.noNote' : 'plugins.graph.empty') : undefined))

// The theme, read for the canvas; reactive, so a change of light, dark or colour redraws.
const palette = computed(() => {
    void props.ctx.ui.theme.dark
    const value = props.ctx.ui.theme.value
    return {
        note: value('--ui-text-muted'),
        attachment: value('--ui-warning'),
        tag: value('--ui-success'),
        unresolved: value('--ui-text-dimmed'),
        link: value('--ui-border-accented'),
        focus: value('--ui-primary'),
        label: value('--ui-text'),
        background: value('--ui-bg'),
    }
})
const groups = computed(() => parseGroups(config.value.groups))

// The simulation, over nodes kept across updates so they stay where they were.
interface SimNode extends SimulationNodeDatum, GraphNode {
    degree: number
}
type SimLink = SimulationLinkDatum<SimNode>

const container = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const hovered = shallowRef<SimNode>()
let nodes: SimNode[] = []
let links: SimLink[] = []
let neighbours = new Map<string, Set<string>>()
let transform: ZoomTransform = zoomIdentity
let size = {width: 0, height: 0}
let zoomer: ZoomBehavior<HTMLCanvasElement, unknown> | undefined
/** Zoom to fit once the layout has settled: the first one, and the local graph's for each new note. */
let fitting = true
/** The user has zoomed or panned: a resize leaves the view where they put it. */
let moved = false
const simulation = forceSimulation<SimNode, SimLink>()
    .force('link', forceLink<SimNode, SimLink>().id(d => d.id))
    .force('charge', forceManyBody<SimNode>())
    .force('x', forceX<SimNode>())
    .force('y', forceY<SimNode>())
    .on('tick', () => {
        if (fitting && simulation.alpha() < 0.1) {
            fitting = false
            fit()
        }
        draw()
    })

watchEffect(() => {
    const {centerForce, repelForce, linkForce, linkDistance} = config.value
    simulation.force<ReturnType<typeof forceLink<SimNode, SimLink>>>('link')!.distance(linkDistance).strength(linkForce)
    simulation.force<ReturnType<typeof forceManyBody<SimNode>>>('charge')!.strength(-repelForce)
    simulation.force<ReturnType<typeof forceX<SimNode>>>('x')!.strength(centerForce)
    simulation.force<ReturnType<typeof forceY<SimNode>>>('y')!.strength(centerForce)
    simulation.alpha(Math.max(simulation.alpha(), 0.3)).restart()
})

const radius = (node: SimNode) => 3 + Math.sqrt(node.degree) * 1.5
const isCentre = (node: SimNode) => props.mode === 'local' && node.id === centre.value

let shape = ''
let shownCentre: string | undefined
watch(graph, next => {
    // A save that changes nothing the graph shows leaves the layout alone.
    const nextShape = `${next.nodes.map(n => `${n.id}:${n.label}`).join('|')}\n${next.links.map(l => `${l.source}>${l.target}`).join('|')}`
    if (nextShape === shape) return
    const first = !shape
    shape = nextShape
    if (first || shownCentre !== centre.value) {
        fitting = true
        moved = false
    } else if (!moved) fitting = true
    shownCentre = centre.value
    const old = new Map(nodes.map(n => [n.id, n]))
    const degree = new Map<string, number>()
    neighbours = new Map()
    for (const {source, target} of next.links) {
        degree.set(source, (degree.get(source) ?? 0) + 1)
        degree.set(target, (degree.get(target) ?? 0) + 1)
        neighbours.set(source, (neighbours.get(source) ?? new Set()).add(target))
        neighbours.set(target, (neighbours.get(target) ?? new Set()).add(source))
    }
    nodes = next.nodes.map(n => {
        const kept = old.get(n.id)
        // A new node starts beside a node it links to, else somewhere near the middle.
        const near = kept ?? [...neighbours.get(n.id) ?? []].map(id => old.get(id)).find(Boolean)
        const jitter = () => (Math.random() - 0.5) * 40
        return Object.assign(kept ?? {x: (near?.x ?? 0) + jitter(), y: (near?.y ?? 0) + jitter()}, n, {degree: degree.get(n.id) ?? 0})
    })
    links = next.links.map(l => ({source: l.source, target: l.target}))
    // The local graph's note stays in the middle.
    for (const node of nodes) {
        const pinned = isCentre(node)
        node.fx = pinned ? 0 : null
        node.fy = pinned ? 0 : null
    }
    simulation.nodes(nodes)
    simulation.force<ReturnType<typeof forceLink<SimNode, SimLink>>>('link')!.links(links)
    simulation.alpha(first ? 1 : 0.3).restart()
    if (hovered.value && !old.has(hovered.value.id)) hovered.value = undefined
}, {immediate: true})

let frame = 0
function draw() {
    if (frame) return
    frame = requestAnimationFrame(() => {
        frame = 0
        paint()
    })
}

function paint() {
    const el = canvas.value
    const context = el?.getContext('2d')
    if (!el || !context) return
    const colors = palette.value
    const ratio = window.devicePixelRatio || 1
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, el.width, el.height)
    context.setTransform(ratio * transform.k, 0, 0, ratio * transform.k, ratio * transform.x, ratio * transform.y)

    const focus = hovered.value?.id ?? (props.mode === 'local' ? centre.value : undefined)
    const lit = focus ? new Set([focus, ...neighbours.get(focus) ?? []]) : undefined
    const faded = (id: string) => !!lit && !lit.has(id)

    context.lineWidth = 1 / transform.k
    for (const pass of [false, true]) {
        context.beginPath()
        for (const link of links) {
            const a = link.source as SimNode, b = link.target as SimNode
            const on = !!focus && (a.id === focus || b.id === focus)
            if (on !== pass) continue
            context.moveTo(a.x!, a.y!)
            context.lineTo(b.x!, b.y!)
        }
        context.globalAlpha = pass ? 0.9 : lit ? 0.15 : 0.6
        context.strokeStyle = pass ? colors.focus : colors.link
        context.stroke()
    }

    for (const node of nodes) {
        context.globalAlpha = faded(node.id) ? 0.2 : 1
        context.fillStyle = node.id === focus ? colors.focus : groupColor(node, groups.value) ?? colors[node.kind]
        context.beginPath()
        context.arc(node.x!, node.y!, radius(node), 0, Math.PI * 2)
        context.fill()
    }

    // Names: all of them once zoomed in, else only around the focus.
    const all = transform.k >= 1.5
    context.font = `${12 / transform.k}px ui-sans-serif, system-ui, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'top'
    context.fillStyle = colors.label
    for (const node of nodes) {
        if (!all && !lit?.has(node.id)) continue
        context.globalAlpha = faded(node.id) ? 0.2 : 1
        context.fillText(node.label, node.x!, node.y! + radius(node) + 2 / transform.k)
    }
    context.globalAlpha = 1
}

watch([palette, groups, hovered, centre], draw)

/** The node under a point of the canvas (CSS pixels). */
function nodeAt(x: number, y: number): SimNode | undefined {
    const [gx, gy] = transform.invert([x, y])
    const found = simulation.find(gx, gy, 12 / transform.k)
    return found && Math.hypot(found.x! - gx, found.y! - gy) <= radius(found) + 6 / transform.k ? found : undefined
}

/** Zooms so every node is in view. */
function fit() {
    if (!canvas.value || !zoomer || !nodes.length || !size.width) return
    const xs = nodes.map(n => n.x!), ys = nodes.map(n => n.y!)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    // A margin of 48 px for the outer nodes' names (less in a small pane).
    const room = (length: number) => Math.max(length - 96, length / 2)
    const k = Math.min(4, Math.min(room(size.width) / Math.max(x1 - x0, 1), room(size.height) / Math.max(y1 - y0, 1)))
    select(canvas.value).call(zoomer.transform, zoomIdentity.translate(size.width / 2, size.height / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2))
}

watchEffect(() => props.actions([{id: 'graph-fit', label: t('plugins.graph.fit'), icon: 'i-lucide-scan', onSelect: fit}]))

let resize: ResizeObserver | undefined
onMounted(() => {
    const el = canvas.value!
    resize = new ResizeObserver(([entry]) => {
        const {width, height} = entry!.contentRect
        const ratio = window.devicePixelRatio || 1
        const first = !size.width
        size = {width, height}
        el.width = Math.round(width * ratio)
        el.height = Math.round(height * ratio)
        el.style.width = `${width}px`
        el.style.height = `${height}px`
        // The first size puts the origin in the middle; later ones keep the graph in view (a pane or a tab settling
        // into its size) until the user moves it.
        if (first && zoomer) select(el).call(zoomer.transform, zoomIdentity.translate(width / 2, height / 2))
        else if (!moved && !fitting) fit()
        draw()
    })
    resize.observe(container.value!)

    // Drag first: on a node it takes the gesture; anywhere else the zoom pans.
    select(el).call(drag<HTMLCanvasElement, unknown, { node: SimNode, x: number, y: number } | undefined>()
        .subject(event => {
            const node = nodeAt(event.x, event.y)
            return node && {node, x: transform.applyX(node.x!), y: transform.applyY(node.y!)}
        })
        .on('start', event => {
            if (!event.active) simulation.alphaTarget(0.3).restart()
            event.subject!.node.fx = event.subject!.node.x
            event.subject!.node.fy = event.subject!.node.y
        })
        .on('drag', event => {
            event.subject!.node.fx = transform.invertX(event.x)
            event.subject!.node.fy = transform.invertY(event.y)
        })
        .on('end', event => {
            if (!event.active) simulation.alphaTarget(0)
            const pinned = isCentre(event.subject!.node)
            event.subject!.node.fx = pinned ? 0 : null
            event.subject!.node.fy = pinned ? 0 : null
        }))
    zoomer = zoom<HTMLCanvasElement, unknown>().scaleExtent([0.02, 8]).on('zoom', event => {
        if (event.sourceEvent) {
            fitting = false
            moved = true
        }
        transform = event.transform
        draw()
    })
    select(el).call(zoomer).on('dblclick.zoom', null)
})

onBeforeUnmount(() => {
    simulation.stop()
    resize?.disconnect()
    cancelAnimationFrame(frame)
})

function pointerMove(event: PointerEvent) {
    const box = canvas.value!.getBoundingClientRect()
    const node = nodeAt(event.clientX - box.left, event.clientY - box.top)
    if (node !== hovered.value) hovered.value = node
}

/** A click on a note or an attachment opens it (a drag or a pan isn't a click: d3 swallows those). */
function click(event: MouseEvent) {
    const box = canvas.value!.getBoundingClientRect()
    const node = nodeAt(event.clientX - box.left, event.clientY - box.top)
    if (node && (node.kind === 'note' || node.kind === 'attachment')) void props.session.tabs.open(node.id)
}
</script>

<template>
    <div ref="container" class="graph">
        <canvas
            ref="canvas"
            :class="{hovering: hovered}"
            @pointermove="pointerMove"
            @pointerleave="hovered = undefined"
            @click="click"
        />
        <p v-if="empty">
            {{ empty }}
        </p>
    </div>
</template>

<!-- Plain CSS: a canvas and one line of text need no utilities. -->
<style scoped>
.graph {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 12rem;
    overflow: hidden;
}

canvas {
    position: absolute;
    inset: 0;
    cursor: grab;
}

canvas.hovering {
    cursor: pointer;
}

p {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    text-align: center;
    font-size: 0.875rem;
    color: var(--ui-text-muted);
    pointer-events: none;
}
</style>

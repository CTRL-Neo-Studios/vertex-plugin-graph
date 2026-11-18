/**
 * The graph's data, from the workspace's files: what's a node, what's an edge, what the filters keep, what's around a
 * note, which colour group a node is in. No drawing, no Vertex: the view feeds it the index.
 */

/** A workspace file as the graph reads it. */
export interface GraphFile {
    uuid: string
    /** Workspace-relative, with its extension. */
    path: string
    /** Without its extension. */
    name: string
    /** Lowercase, without the dot; `''` for none. */
    ext: string
    /** Uuids of the files it links to. */
    links: string[]
    /** Link targets that find no file. */
    unresolved: string[]
    /** Lowercase, without `#`: frontmatter and body. */
    tags: string[]
}

export type NodeKind = 'note' | 'attachment' | 'tag' | 'unresolved'

export interface GraphNode {
    /** A file's uuid, `tag:<tag>`, or `unresolved:<target>`. */
    id: string
    kind: NodeKind
    label: string
    /** A file's workspace-relative path. */
    path?: string
    tags: string[]
}

export interface GraphLink {
    source: string
    target: string
}

export interface Graph {
    nodes: GraphNode[]
    links: GraphLink[]
}

export interface GraphFilters {
    showTags: boolean
    showAttachments: boolean
    showUnresolved: boolean
    showOrphans: boolean
}

/** Notes are what the editor writes; anything else linked is an attachment. */
const isNote = (file: GraphFile) => file.ext === 'md' || file.ext === 'txt'

/**
 * Notes are nodes, links between them edges. Attachments (files a note links to that aren't notes), tags (an edge from
 * each note that has one) and unresolved targets join when shown. An orphan, a node with no edge, is left out unless
 * shown. Edges are each pair once, whichever way.
 */
export function buildGraph(files: GraphFile[], filters: GraphFilters): Graph {
    const byUuid = new Map(files.map(f => [f.uuid, f]))
    const nodes = new Map<string, GraphNode>()
    const links = new Map<string, GraphLink>()
    const link = (a: string, b: string) => {
        if (a === b) return
        const key = a < b ? `${a}\n${b}` : `${b}\n${a}`
        if (!links.has(key)) links.set(key, {source: a, target: b})
    }
    const fileNode = (file: GraphFile): GraphNode =>
        ({id: file.uuid, kind: isNote(file) ? 'note' : 'attachment', label: file.name, path: file.path, tags: file.tags})

    for (const file of files) if (isNote(file)) nodes.set(file.uuid, fileNode(file))
    for (const file of files) {
        if (!isNote(file)) continue
        for (const to of file.links) {
            const target = byUuid.get(to)
            if (!target) continue
            if (!isNote(target)) {
                if (!filters.showAttachments) continue
                if (!nodes.has(to)) nodes.set(to, fileNode(target))
            }
            link(file.uuid, to)
        }
        if (filters.showUnresolved) for (const target of file.unresolved) {
            const id = `unresolved:${target}`
            if (!nodes.has(id)) nodes.set(id, {id, kind: 'unresolved', label: target, tags: []})
            link(file.uuid, id)
        }
        if (filters.showTags) for (const tag of file.tags) {
            const id = `tag:${tag}`
            if (!nodes.has(id)) nodes.set(id, {id, kind: 'tag', label: `#${tag}`, tags: [tag]})
            link(file.uuid, id)
        }
    }
    let kept = [...nodes.values()]
    if (!filters.showOrphans) {
        const linked = new Set([...links.values()].flatMap(l => [l.source, l.target]))
        kept = kept.filter(n => linked.has(n.id))
    }
    return {nodes: kept, links: [...links.values()]}
}

/** The nodes within `depth` edges of `centre` (either way) and the edges among them; empty when `centre` isn't a node. */
export function neighbourhood(graph: Graph, centre: string, depth: number): Graph {
    if (!graph.nodes.some(n => n.id === centre)) return {nodes: [], links: []}
    const next = new Map<string, string[]>()
    for (const {source, target} of graph.links) {
        next.set(source, [...next.get(source) ?? [], target])
        next.set(target, [...next.get(target) ?? [], source])
    }
    const seen = new Set([centre])
    let ring = [centre]
    for (let d = 0; d < depth && ring.length; d++) {
        ring = ring.flatMap(id => next.get(id) ?? []).filter(id => !seen.has(id) && seen.add(id))
    }
    return {
        nodes: graph.nodes.filter(n => seen.has(n.id)),
        links: graph.links.filter(l => seen.has(l.source) && seen.has(l.target)),
    }
}

/** A colour group: the nodes a query finds, drawn in a colour. */
export interface ColorGroup {
    kind: 'path' | 'tag' | 'name'
    value: string
    color: string
}

/**
 * Colour groups from the config's lines, `<query> <colour>`: `path:Projects/ #f59e0b` (a path that starts with it),
 * `tag:idea green` (the tag, or one nested in it), or any other text (a name that holds it). The colour is the last
 * word, any CSS colour. A line without both is skipped.
 */
export function parseGroups(lines: readonly string[]): ColorGroup[] {
    return lines.flatMap((line): ColorGroup[] => {
        const match = /^\s*(.+?)\s+(\S+)\s*$/.exec(line)
        if (!match) return []
        const [, query, color] = match as unknown as [string, string, string]
        const prefixed = /^(path|tag):(.+)$/.exec(query)
        if (!prefixed) return [{kind: 'name' as const, value: query.toLowerCase(), color}]
        const kind = prefixed[1] as 'path' | 'tag'
        const value = kind === 'tag' ? prefixed[2]!.replace(/^#/, '').toLowerCase() : prefixed[2]!.toLowerCase()
        return [{kind, value, color}]
    })
}

/** The colour of the first group that finds the node. */
export function groupColor(node: GraphNode, groups: readonly ColorGroup[]): string | undefined {
    return groups.find(group => {
        if (group.kind === 'path') return !!node.path && node.path.toLowerCase().startsWith(group.value)
        if (group.kind === 'tag') return node.tags.some(tag => tag === group.value || tag.startsWith(`${group.value}/`))
        return node.label.toLowerCase().includes(group.value)
    })?.color
}

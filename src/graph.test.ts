import {describe, expect, it} from 'bun:test'
import {buildGraph, type GraphFile, groupColor, neighbourhood, parseGroups} from './graph'

const file = (uuid: string, path: string, more: Partial<GraphFile> = {}): GraphFile => {
    const name = path.split('/').pop()!
    const dot = name.lastIndexOf('.')
    return {uuid, path, name: dot > 0 ? name.slice(0, dot) : name, ext: dot > 0 ? name.slice(dot + 1) : '', links: [], unresolved: [], tags: [], ...more}
}
const none = {showTags: false, showAttachments: false, showUnresolved: false, showOrphans: true}
const ids = (graph: { nodes: { id: string }[] }) => graph.nodes.map(n => n.id).sort()

describe('buildGraph', () => {
    const files = [
        file('a', 'A.md', {links: ['b', 'img'], unresolved: ['Nowhere'], tags: ['idea']}),
        file('b', 'notes/B.md', {links: ['a']}),
        file('c', 'C.md'),
        file('img', 'pic.png'),
    ]

    it('makes notes nodes and a link either way one edge', () => {
        const graph = buildGraph(files, none)
        expect(ids(graph)).toEqual(['a', 'b', 'c'])
        expect(graph.links).toEqual([{source: 'a', target: 'b'}])
    })

    it('adds attachments, unresolved targets and tags when shown', () => {
        const graph = buildGraph(files, {...none, showTags: true, showAttachments: true, showUnresolved: true})
        expect(ids(graph)).toEqual(['a', 'b', 'c', 'img', 'tag:idea', 'unresolved:Nowhere'])
        expect(graph.nodes.find(n => n.id === 'img')?.kind).toBe('attachment')
        expect(graph.links).toContainEqual({source: 'a', target: 'tag:idea'})
    })

    it('leaves orphans out unless shown', () => {
        expect(ids(buildGraph(files, {...none, showOrphans: false}))).toEqual(['a', 'b'])
    })
})

describe('neighbourhood', () => {
    const chain = buildGraph([
        file('a', 'A.md', {links: ['b']}), file('b', 'B.md', {links: ['c']}), file('c', 'C.md', {links: ['d']}), file('d', 'D.md'),
    ], none)

    it('keeps what is within the depth, either way', () => {
        expect(ids(neighbourhood(chain, 'b', 1))).toEqual(['a', 'b', 'c'])
        expect(ids(neighbourhood(chain, 'b', 2))).toEqual(['a', 'b', 'c', 'd'])
        expect(neighbourhood(chain, 'b', 1).links).toHaveLength(2)
    })

    it('is empty for a centre that is not a node', () => {
        expect(neighbourhood(chain, 'zzz', 3)).toEqual({nodes: [], links: []})
    })
})

describe('colour groups', () => {
    const groups = parseGroups(['path:Projects/ #f59e0b', 'tag:#idea green', 'daily rgb(0,0,255)', 'nothing'])

    it('reads each line as a query and its colour', () => {
        expect(groups).toEqual([
            {kind: 'path', value: 'projects/', color: '#f59e0b'},
            {kind: 'tag', value: 'idea', color: 'green'},
            {kind: 'name', value: 'daily', color: 'rgb(0,0,255)'},
        ])
    })

    it('colours a node by the first group that finds it', () => {
        const node = (more: object) => ({id: 'x', kind: 'note' as const, label: 'X', tags: [], ...more})
        expect(groupColor(node({path: 'Projects/Plan.md'}), groups)).toBe('#f59e0b')
        expect(groupColor(node({tags: ['idea/small']}), groups)).toBe('green')
        expect(groupColor(node({label: '2025 Daily'}), groups)).toBe('rgb(0,0,255)')
        expect(groupColor(node({label: 'Other'}), groups)).toBeUndefined()
    })
})

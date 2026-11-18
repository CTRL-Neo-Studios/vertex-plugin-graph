import {definePlugin, type PanelViewProps} from '@type32/vertex-plugin'
import {h} from 'vue'
import GraphView, {type GraphConfig} from './GraphView.vue'

export default definePlugin<GraphConfig>({
    setup(ctx) {
        // Two views of one graph: the whole workspace, and the notes around the shown one. Both may open in a tab as
        // well as in a pane; each keeps its own layout.
        const view = (mode: 'global' | 'local') => async () => (props: PanelViewProps) => h(GraphView, {...props, ctx, mode})
        ctx.views.panel({
            id: 'graph',
            label: 'plugins.graph.view',
            icon: 'i-lucide-waypoints',
            defaultArea: 'hidden',
            tab: true,
            when: ({isWorkspace}) => isWorkspace,
            component: view('global'),
        })
        ctx.views.panel({
            id: 'graph-local',
            label: 'plugins.graph.localView',
            icon: 'i-lucide-git-fork',
            defaultArea: 'right',
            tab: true,
            when: ({isWorkspace}) => isWorkspace,
            component: view('local'),
        })

        ctx.onSession(session => {
            if (!session.session.workspaceSession) return
            ctx.commands.register({
                id: 'open',
                label: 'plugins.graph.open',
                icon: 'i-lucide-waypoints',
                menu: {section: 'view'},
                palette: true,
                run: () => session.views.openInTab('graph'),
            })
            ctx.commands.register({
                id: 'open-local',
                label: 'plugins.graph.openLocal',
                icon: 'i-lucide-git-fork',
                menu: {section: 'view'},
                palette: true,
                run: () => session.views.show('graph-local') || session.views.openInTab('graph-local'),
            })
        })
    },
})

import { Controller } from '@hotwired/stimulus';
import { createTree, getTree, destroyTree } from '../jstree_runtime.js';
import { createEngine } from '@tacman1123/twig-browser';
import { installSymfonyTwigAPI } from '@tacman1123/twig-browser/adapters/symfony';
import { compileTwigBlocks as compileTwigBlocksCompat } from '@tacman1123/twig-browser/src/compat/compileTwigBlocks.js';
import { sourceFromScriptContent } from '../lib/twig_block_registry.mjs';

let _twigHelpersError = null;
let _twigEngine = null;

async function loadTwigHelpers() {
    if (_twigEngine) {
        return _twigEngine;
    }

    let pathGenerator = null;
    try {
        const mod = await import('@survos/js-twig/generated/fos_routes.js');
        pathGenerator = mod.path || null;
    } catch (error) {
        _twigHelpersError = error;
    }

    if (!pathGenerator) {
        throw new Error('[api_tree] Missing route generator for Twig path(). Add @survos/js-twig/generated/fos_routes.js to importmap and ensure the cache warmer generated var/js_twig_bundle/generated/fos_routes.js.');
    }

    _twigEngine = createEngine();
    installSymfonyTwigAPI(_twigEngine, { pathGenerator });
    return _twigEngine;
}

function compileBlocks(engine, registry, blocksId) {
    const scriptEl = typeof document !== 'undefined' ? document.getElementById(blocksId) : null;

    if (!scriptEl) {
        compileTwigBlocksCompat(engine, registry, blocksId);
        return;
    }

    const raw = scriptEl.textContent ?? '';
    let source;
    try {
        source = sourceFromScriptContent(raw);
    } catch (error) {
        console.warn('[api_tree] Failed to parse JSON block registry, falling back to direct source parsing.', {
            blocksId,
            error: String(error),
        });
        source = raw;
    }

    compileTwigBlocksCompat(engine, registry, source);
}

export default class extends Controller {
    static targets = ['ajax', 'message', 'content'];

    static values = {
        apiCall: { type: String, default: '' },
        itemApiPattern: { type: String, default: '' },
        labelField: { type: String, default: 'name' },
        filter: { type: String, default: '{}' },
        globals: { type: String, default: '{}' },
        selectedId: { type: String, default: '' },
        plugins: { type: Array, default: ['search', 'types', 'dnd', 'contextmenu'] },
        types: { type: Object, default: {} },
        editable: { type: Boolean, default: true },
        /** Open all nodes on initial load. */
        openAll: { type: Boolean, default: false },
        selectFirst: { type: Boolean, default: false },
        /** ID of a <script type="application/json"> element containing twig block templates. */
        blocksId: { type: String, default: '' },
        debug: { type: Boolean, default: false },
    };

    async connect() {
        this.baseUrl = this.apiCallValue;
        this.filterObj = this.parseFilter(this.filterValue);
        this.globalsObj = this.parseFilter(this.globalsValue);
        this.pendingCreates = new Set();
        this.pendingParentByNodeId = new Map();
        this.pendingDraftNameByNodeId = new Map();
        this.pendingTypeByNodeId = new Map();
        this.nodeIriById = new Map();
        this.recordCache = new Map();
        this.boundTreeHandlers = [];
        this._tpl = {};
        this.notify(`api_tree: ${this.baseUrl}`);
        this.dbg('[api_tree] connect', {
            apiCall: this.baseUrl,
            editable: this.editableValue,
            plugins: this.pluginsValue,
            blocksId: this.blocksIdValue,
            debug: this.debugValue,
        });

        // Load twig.js helpers and compile blocks from the inline <script> registry.
        await loadTwigHelpers();
        this._twigEngine = _twigEngine;
        const blocksId = this.blocksIdValue || 'api-tree-blocks';
        this.dbg('[api_tree] twig helper availability', {
            hasTwigEngine: !!this._twigEngine,
            hasCompileTwigBlocks: true,
            blocksId,
        });
        if (this._twigEngine) {
            try {
                compileBlocks(this._twigEngine, this._tpl, blocksId);
                this.dbg('[api_tree] compiled twig blocks', {
                    blocksId,
                    compiledKeys: Object.keys(this._tpl || {}),
                });
            } catch (error) {
                const scriptEl = document.getElementById(blocksId);
                const snippet = (scriptEl?.textContent ?? '').trim().slice(0, 240);
                console.warn('[api_tree] Twig block compile failed; falling back to default labels/content.', {
                    blocksId,
                    error: String(error),
                    scriptType: scriptEl?.type ?? null,
                    scriptSnippet: snippet,
                });
                this.notify('api_tree: custom twig blocks failed to compile; using fallback rendering');
            }
        } else {
            const hasBlocksScript = !!document.getElementById(blocksId);
            console.warn('[api_tree] Twig block rendering disabled; using fallback labels/content.', {
                blocksId,
                hasBlocksScript,
                hint: 'Install/import @tacman1123/twig-browser and its Symfony adapter for <twig:block> rendering in api_tree.',
                importmapHint: 'Map @tacman1123/twig-browser, @tacman1123/twig-browser/adapters/symfony, and @tacman1123/twig-browser/src/compat/compileTwigBlocks.js.',
                error: _twigHelpersError ? String(_twigHelpersError) : null,
            });
            if (hasBlocksScript) {
                this.notify('api_tree: custom twig blocks disabled (missing @tacman1123/twig-browser compat modules)');
            }
        }

        if (!this.hasAjaxTarget || !this.baseUrl) {
            return;
        }

        await this.renderTree();

        this._onExternalSelect = (event) => {
            const requestedId = event.detail?.id ?? event.detail?.data?.id ?? null;
            if (!requestedId) {
                return;
            }

            this.autoSelectedNodeId = String(requestedId);
            this.selectAndOpen(requestedId);
        };
        window.addEventListener('apitree:select', this._onExternalSelect);
    }

    disconnect() {
        if (this._searchTimer) {
            clearTimeout(this._searchTimer);
        }
        if (this.hasAjaxTarget) {
            this.unbindTreeEvents();
            destroyTree(this.ajaxTarget);
        }
        if (this._onExternalSelect) {
            window.removeEventListener('apitree:select', this._onExternalSelect);
            this._onExternalSelect = null;
        }
        this.autoSelectedNodeId = null;
    }

    async renderTree() {
        const members = await this.fetchAllNodes();
        const data = this.toJsTreeData(members);
        const report = this.validateTreeData(data);
        const plugins = this.resolvedPlugins();

        if (report.invalidParents.length || report.duplicateIds.length || report.missingIds.length) {
            this.reportTreeDataIssues(report, members, data);
        }

        this.ajaxTarget.innerHTML = '';
        createTree(this.ajaxTarget, {
            plugins,
            core: {
                data,
                check_callback: this.editableValue,
                error: (error) => {
                    this.handleTreeError(error, members, data);
                },
                themes: {
                    name: false,
                    url: false,
                    dots: false,
                    icons: true,
                },
            },
            types: this.typesValue,
            contextmenu: this.editableValue ? {
                items: (node) => {
                    const items = {};

                    // Build one "New <Type>" entry per configured type,
                    // skipping generic meta-types that aren't real entity types.
                    const skipTypes = new Set(['default', 'file', 'dir']);
                    const typeEntries = Object.entries(this.typesValue || {})
                        .filter(([key]) => !skipTypes.has(key));

                    if (typeEntries.length > 0) {
                        typeEntries.forEach(([typeKey, typeDef]) => {
                            const icon = typeDef.icon ?? '';
                            const iconHtml = icon ? `<i class="${icon}"></i> ` : '';
                            const label = typeKey.charAt(0).toUpperCase() + typeKey.slice(1).replace(/-/g, ' ');
                            items[`create_${typeKey}`] = {
                                label: `${iconHtml}New ${label}`,
                                action: () => {
                                    const tree = getTree(this.ajaxTarget);
                                    if (!tree) return;
                                    const draftLabel = `New ${label}`;
                                    const created = tree.create_node(node.id, { text: draftLabel }, 'last');
                                    if (created) {
                                        this.pendingParentByNodeId.set(String(created), String(node.id));
                                        this.pendingDraftNameByNodeId.set(String(created), draftLabel);
                                        this.pendingTypeByNodeId.set(String(created), typeKey);
                                        tree.edit(created);
                                    }
                                },
                            };
                        });
                    } else {
                        // Fallback: no types configured — single generic "Add child"
                        items.create = {
                            label: `
                                <svg xmlns="http://www.w3.org/2000/svg" width="1.25em" height="1.25em" viewBox="0 0 24 24">
	                                <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12s4.477 10 10 10s10-4.477 10-10M12 8v8m4-4H8" />
                                </svg>
                                <span>Add Child</span>
                            `,
                            action: () => {
                                const tree = getTree(this.ajaxTarget);
                                if (!tree) return;
                                const label = this.nextChildLabel(node.id);
                                const created = tree.create_node(node.id, { text: label }, 'last');
                                if (created) {
                                    this.pendingParentByNodeId.set(String(created), String(node.id));
                                    this.pendingDraftNameByNodeId.set(String(created), label);
                                    tree.edit(created);
                                }
                            },
                        };
                    }

                    items.rename = {
                        label: `
                            <svg xmlns="http://www.w3.org/2000/svg" width="1.25em" height="1.25em" viewBox="0 0 24 24">
	                            <g fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5">
		                            <path d="m16.425 4.605l.99-.99a2.1 2.1 0 0 1 2.97 2.97l-.99.99m-2.97-2.97l-6.66 6.66a3.96 3.96 0 0 0-1.041 1.84L8 16l2.896-.724a3.96 3.96 0 0 0 1.84-1.042l6.659-6.659m-2.97-2.97l2.97 2.97" />
		                            <path stroke-linecap="round" d="M19 13.5c0 3.288 0 4.931-.908 6.038a4 4 0 0 1-.554.554C16.43 21 14.788 21 11.5 21H11c-3.771 0-5.657 0-6.828-1.172S3 16.771 3 13v-.5c0-3.287 0-4.931.908-6.038q.25-.304.554-.554C5.57 5 7.212 5 10.5 5" />
	                            </g>
                            </svg>
                            <span>Rename</span>
                        `,
                        action: () => {
                            const tree = getTree(this.ajaxTarget);
                            if (!tree) return;
                            tree.edit(node);
                        },
                    };
                    items.remove = {
                        label: `
                            <svg xmlns="http://www.w3.org/2000/svg" width="1.25em" height="1.25em" viewBox="0 0 24 24">
	                            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="m19.5 5.5l-.62 10.025c-.158 2.561-.237 3.842-.88 4.763a4 4 0 0 1-1.2 1.128c-.957.584-2.24.584-4.806.584c-2.57 0-3.855 0-4.814-.585a4 4 0 0 1-1.2-1.13c-.642-.922-.72-2.205-.874-4.77L4.5 5.5M3 5.5h18m-4.944 0l-.683-1.408c-.453-.936-.68-1.403-1.071-1.695a2 2 0 0 0-.275-.172C13.594 2 13.074 2 12.035 2c-1.066 0-1.599 0-2.04.234a2 2 0 0 0-.278.18c-.395.303-.616.788-1.058 1.757L8.053 5.5m1.447 11v-6m5 6v-6" />
                            </svg>
                            <span>Delete</span>
                        `,
                        action: () => {
                            const tree = getTree(this.ajaxTarget);
                            if (!tree) return;
                            tree.delete_node(node);
                        },
                    };

                    return items;
                },
            } : {},
        });

        this.bindTreeEvents();

        // Open all nodes on initial load if requested.
        this.ajaxTarget.addEventListener('ready.jstree', () => {
            const tree = getTree(this.ajaxTarget);
            if (!tree) {
                return;
            }

            if (this.openAllValue) {
                tree.open_all();
            }

            if (this.selectedIdValue) {
                this.autoSelectedNodeId = String(this.selectedIdValue);
                this.selectAndOpen(this.selectedIdValue);
                return;
            }

            if (this.selectFirstValue) {
                const nodes = tree.get_json('#', { flat: true }) || [];
                const first = nodes.find((node) => node && node.id && node.id !== '#');
                if (first?.id) {
                    this.autoSelectedNodeId = String(first.id);
                    tree.deselect_all(true);
                    tree.select_node(String(first.id), false, true);
                    tree.open_node(String(first.id));
                    this.renderSelectedContent(first).catch((error) => {
                        this.notify(`api_tree: content failed (${error.message})`);
                        console.error('[api_tree] initial content render failed', { error, first });
                    });
                }
            }
        }, { once: true });

        // Shift+click on any node → open_all descendants (like Symfony Dump's shift+click)
        this.ajaxTarget.addEventListener('click', (e) => {
            if (!e.shiftKey) return;
            const anchor = e.target.closest('.jstree-anchor');
            if (!anchor) return;
            e.preventDefault();
            e.stopPropagation();
            const tree = getTree(this.ajaxTarget);
            if (!tree) return;
            const nodeEl = anchor.closest('[role="treeitem"], li');
            const nodeId = nodeEl?.id;
            if (nodeId) tree.open_all(nodeId);
        });
    }

    parseFilter(raw) {
        try {
            const parsed = JSON.parse(raw || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    notify(message) {
        if (this.hasMessageTarget) {
            this.messageTarget.textContent = message;
        }
    }

    dbg(message, payload = null) {
        if (!this.debugValue) {
            return;
        }
        if (payload === null) {
            console.debug(message);
            return;
        }
        console.debug(message, payload);
    }

    async fetchAllNodes() {
        const url = new URL(this.baseUrl, window.location.origin);
        Object.entries(this.filterObj).forEach(([k, v]) => {
            if (v !== null && v !== undefined && v !== '') {
                url.searchParams.set(k, String(v));
            }
        });
        this.dbg('[api_tree] fetch URL', url.toString());

        const response = await fetch(url.toString(), {
            headers: {
                Accept: 'application/ld+json, application/json',
            },
        });
        if (!response.ok) {
            this.notify(`api_tree: ${response.status} ${response.statusText}`);
            return [];
        }

        const payload = await response.json();
        const members = payload['hydra:member'] || payload.member || payload.items || payload;
        if (!Array.isArray(members)) {
            return [];
        }
        this.firstLoadedNode = members[0] || null;
        this.nodeIriById.clear();
        for (const node of members) {
            const id = this.nodeId(node);
            const iri = node?.['@id'] || null;
            if (id && iri) {
                this.nodeIriById.set(String(id), String(iri));
            }
        }
        this.notify(`api_tree: loaded ${members.length} nodes`);
        return members;
    }

    toJsTreeData(members) {
        return members.map((node) => {
            const id = this.nodeId(node);
            const parent = this.nodeParent(node);
            const isDir = node.isDir === true;

            // Use instanceType (API Platform) or isDir as the jstree type.
            // The types plugin will apply icons/styles per type if typesValue is set.
            const nodeType = node.instanceType ?? (isDir ? 'dir' : 'file');

            // Determine icon: prefer types config, then instanceType-based default.
            const typeDef = this.typesValue?.[nodeType];
            const icon = typeDef?.icon ?? (isDir ? 'bi bi-folder2-open' : 'bi bi-file-earmark');

            const label = this.nodeLabel(node);
            const text = label;

            return {
                id,
                parent,
                text,
                icon,
                type: nodeType,
                data: node,
            };
        });
    }

    validateTreeData(data) {
        const ids = new Set(['#']);
        const duplicateIds = [];
        const missingIds = [];

        for (const node of data) {
            const id = node?.id ?? null;
            if (id === null || id === undefined || id === '') {
                missingIds.push(node);
                continue;
            }

            const strId = String(id);
            if (ids.has(strId)) {
                duplicateIds.push(node);
                continue;
            }

            ids.add(strId);
        }

        const invalidParents = data.filter((node) => {
            const parent = node?.parent ?? '#';
            return parent !== '#' && !ids.has(String(parent));
        });

        return { invalidParents, duplicateIds, missingIds };
    }

    reportTreeDataIssues(report, members, data) {
        if (report.invalidParents.length) {
            const node = report.invalidParents[0];
            const raw = members.find((member) => String(this.nodeId(member)) === String(node.id)) ?? null;
            this.notify(`api_tree: parent id ${node.parent} is missing for node ${node.id}`);
            console.error('[api_tree] invalid parent references detected', {
                message: `Parent id ${node.parent} is missing for node ${node.id}`,
                invalidParents: report.invalidParents,
                firstInvalidNode: node,
                firstInvalidRecord: raw,
                flatTreeData: data,
            });
            return;
        }

        if (report.duplicateIds.length) {
            const node = report.duplicateIds[0];
            this.notify(`api_tree: duplicate node id ${node.id}`);
            console.error('[api_tree] duplicate node ids detected', {
                duplicateIds: report.duplicateIds,
                flatTreeData: data,
            });
            return;
        }

        if (report.missingIds.length) {
            this.notify('api_tree: one or more nodes are missing ids');
            console.error('[api_tree] nodes missing ids detected', {
                missingIds: report.missingIds,
                flatTreeData: data,
            });
        }
    }

    handleTreeError(error, members, data) {
        const reason = error?.reason || error?.error || 'unknown jstree error';
        const details = error?.details || null;

        if (error?.error === 'check' && error?.id === 'core_03') {
            const parsed = this.parseJsTreeErrorData(error?.data);
            const nodeId = parsed?.obj ?? parsed?.id ?? null;
            const parentId = parsed?.par ?? parsed?.parent ?? null;
            console.debug('[api_tree] ignored blocked move/check_callback error', {
                error,
                nodeId,
                parentId,
                editable: this.editableValue,
            });
            return;
        }

        if (reason === 'Node with invalid parent') {
            const nodeId = details?.nodeId ?? null;
            const parentId = details?.parentId ?? null;
            this.notify(`api_tree: parent id ${parentId} is missing for node ${nodeId}`);
        } else {
            this.notify(`api_tree: ${reason}`);
        }

        console.error('[api_tree] jstree core error', {
            error,
            members,
            flatTreeData: data,
        });
    }

    resolvedPlugins() {
        const plugins = Array.isArray(this.pluginsValue) ? [...this.pluginsValue] : [];
        if (this.editableValue) {
            return plugins;
        }

        return plugins.filter((plugin) => !['dnd', 'contextmenu'].includes(String(plugin)));
    }

    parseJsTreeErrorData(raw) {
        if (!raw || typeof raw !== 'string') {
            return null;
        }

        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

     nodeId(node) {
        // Prefer the stable unique id (e.g. xxh3 hash) over code.
        // code is not globally unique across tenants and causes parent→child
        // mismatches when parentId is the hash but nodeId is the code.
        if (node.id !== undefined && node.id !== null && node.id !== '') {
            return String(node.id);
        }
        if (node.code !== undefined && node.code !== null && node.code !== '') {
            return String(node.code);
        }
        if (node['@id']) {
            return this.normalizeApiId(node['@id']);
        }
        return String(Math.random());
    }

    nodeParent(node) {
        const parent = node.parentId ?? node.parent ?? node.parentCode ?? null;
        if (parent === null || parent === '' || parent === '#') {
            return '#';
        }
        if (typeof parent === 'object') {
            if (parent.code !== undefined && parent.code !== null) {
                return String(parent.code);
            }
            if (parent.id !== undefined && parent.id !== null) {
                return String(parent.id);
            }
            if (parent['@id']) {
                return this.normalizeApiId(parent['@id']);
            }
        }
        return this.normalizeApiId(parent);
    }

    normalizeApiId(value) {
        const str = String(value);
        if (str.includes('/')) {
            const parts = str.split('/').filter(Boolean);
            return parts.length ? parts[parts.length - 1] : str;
        }
        return str;
    }

    nodeLabel(node) {
        // If a compiled twig.js block named 'nodeLabel' is available, use it.
        const hasNodeLabelBlock = this.hasCompiledBlock('nodeLabel');
        if (this._twigEngine && hasNodeLabelBlock) {
            try {
                const rendered = this._twigEngine.renderBlock('nodeLabel', { node, globals: this.globalsObj });
                this.dbg('[api_tree] rendered nodeLabel block', {
                    nodeId: node?.id ?? null,
                    rendered,
                });
                return rendered;
            } catch (e) {
                console.warn('[api_tree] nodeLabel twig render failed', e);
            }
        }
        this.dbg('[api_tree] fallback node label used', {
            nodeId: node?.id ?? null,
            availableBlocks: Object.keys(this._tpl || {}),
            sourceBlocks: Object.keys(this._tpl?.__sources__ || {}),
            hasTwigEngine: !!this._twigEngine,
            hasNodeLabelBlock,
        });
        return node[this.labelFieldValue] ?? node.name ?? node.title ?? this.nodeId(node);
    }

    hasCompiledBlock(name) {
        return !!(this._tpl && (
            this._tpl[name]
            || this._tpl.__sources__?.[name]
            || this._tpl.__payloads__?.[name]
            || this._tpl.__meta__?.blockNames?.includes?.(name)
        ));
    }

    /**
     * Programmatically select a node by id and open it (expand its children).
     * Called externally, e.g. from station_controller when a child card is clicked.
     */
    selectAndOpen(id) {
        const tree = getTree(this.ajaxTarget);
        if (!tree) return;
        const strId = String(id);
        // Open all ancestors so the node is visible before selecting it
        const node = tree.get_node(strId);
        if (node) {
            let parentId = tree.get_parent(strId);
            const toOpen = [];
            while (parentId && parentId !== '#') {
                toOpen.unshift(parentId);
                parentId = tree.get_parent(parentId);
            }
            for (const pid of toOpen) {
                tree.open_node(pid, false, false);
            }
        }
        tree.deselect_all(true);
        tree.select_node(strId, false, true);
        tree.open_node(strId);
        // Scroll the selected node into view
        const el = this.ajaxTarget.querySelector(`#${CSS.escape(strId)}`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    search(event) {
        const term = (event.currentTarget?.value || '').trim();

        if (this._searchTimer) {
            clearTimeout(this._searchTimer);
        }

        this._searchTimer = setTimeout(() => {
            const tree = getTree(this.ajaxTarget);
            if (!tree) return;

            if (term === '') {
                this.clearSearch();
            } else {
                tree.search(term);
            }
        }, 250);
    }

    clearSearch() {
        if (this._searchTimer) {
            clearTimeout(this._searchTimer);
        }

        const searchInput = this.element.querySelector('input[type="search"]');
        if (searchInput) {
            searchInput.value = '';
        }

        const tree = getTree(this.ajaxTarget);
        if (!tree) return;

        if (tree._data?.search?.res?.length > 0) {
            tree.clear_search();
        }

        tree.close_all();

        const rootNodes = tree.get_node('#').children;
        if (rootNodes.length) {
            tree.open_node(rootNodes[0]);
        }

        const firstNode = this.ajaxTarget.querySelector('li');
        firstNode?.scrollIntoView({ block: 'start' });
    }

    bindTreeEvents() {
        this.unbindTreeEvents();

        const listeners = [
            [['changed.jstree', 'jstree:changed'], this.onChanged],
            [['select_node.jstree', 'jstree:select_node'], this.onSelectNode],
            [['search.jstree'], this.onSearch],
        ];

        if (this.editableValue) {
            listeners.push([['create_node.jstree', 'jstree:create_node'], this.onCreateNode]);
            listeners.push([['rename_node.jstree', 'jstree:rename_node'], this.onRenameNode]);
            listeners.push([['move_node.jstree', 'jstree:move_node'], this.onMoveNode]);
            listeners.push([['delete_node.jstree', 'jstree:delete_node'], this.onDeleteNode]);
        }

        for (const [eventNames, handler] of listeners) {
            for (const eventName of eventNames) {
                this.ajaxTarget.addEventListener(eventName, handler);
                this.boundTreeHandlers.push({ eventName, handler });
                this.dbg('[api_tree] bound DOM event', eventName);
            }
        }
    }

    unbindTreeEvents() {
        for (const binding of this.boundTreeHandlers || []) {
            this.ajaxTarget.removeEventListener(binding.eventName, binding.handler);
        }
        this.boundTreeHandlers = [];
    }

    addNode() {
        if (!this.editableValue) {
            return;
        }

        const tree = getTree(this.ajaxTarget);
        if (!tree) {
            return;
        }

        const selected = tree.get_selected();
        const parent = selected.length ? selected[0] : '#';
        const label = this.nextChildLabel(parent);
        const nodeId = tree.create_node(parent, { text: label }, 'last');
        if (!nodeId) {
            return;
        }

        this.pendingParentByNodeId.set(String(nodeId), String(parent));
        this.pendingDraftNameByNodeId.set(String(nodeId), label);

        tree.open_node(parent);
        tree.deselect_all();
        tree.select_node(nodeId);
        tree.edit(nodeId);
    }

    deleteSelected() {
        if (!this.editableValue) {
            return;
        }

        const tree = getTree(this.ajaxTarget);
        if (!tree) {
            return;
        }

        const selected = tree.get_selected();
        if (!selected.length) {
            return;
        }

        tree.delete_node(selected);
    }

    onChanged = (event) => {
        const detail = event.detail || {};
        console.debug('[api_tree] changed.jstree', detail);
        this.dispatchNode(detail.node || null, 'changed', detail);
    }

    onSelectNode = (event) => {
        const detail = event.detail || {};
        console.debug('[api_tree] select_node.jstree', detail);
        const selectedId = detail.node?.id ? String(detail.node.id) : null;
        const isAutoSelected = !!(selectedId && this.autoSelectedNodeId && selectedId === this.autoSelectedNodeId);
        const isUserSelection = !!detail.event;

        if (detail.node?.id && this.autoSelectedNodeId && String(detail.node.id) === this.autoSelectedNodeId) {
            this.autoSelectedNodeId = null;
        }

        if (isUserSelection || isAutoSelected) {
            this.renderSelectedContent(detail.node || null).catch((error) => {
                this.notify(`api_tree: content failed (${error.message})`);
                console.error('[api_tree] content render failed', { error, detail });
            });
        } else {
            console.debug('[api_tree] skipping content fetch for non-user selection event', { detail });
        }

        this.dispatchNode(detail.node || null, 'select_node', detail);
    }

    onSearch = (event) => {
        const nodes = event.detail?.nodes || [];
        if (!nodes.length) return;

        const firstId = typeof nodes[0] === 'string' ? nodes[0] : nodes[0]?.id;
        if (!firstId) return;

        const el = this.ajaxTarget.querySelector(`#${CSS.escape(String(firstId))}`);
        el?.scrollIntoView({ block: 'nearest' });
    }

    onCreateNode = (event) => {
        const detail = event.detail || {};
        console.debug('[api_tree] create_node.jstree', detail);
        if (detail.node?.id && !this.pendingParentByNodeId.has(String(detail.node.id))) {
            this.pendingParentByNodeId.set(String(detail.node.id), String(detail.parent || '#'));
            this.pendingDraftNameByNodeId.set(String(detail.node.id), String(detail.node.text || '').trim());
        }
        this.dispatchNode(detail.node || null, 'create_node', detail);
        this.notify('api_tree: new node created locally, waiting for name');
    }

    onRenameNode = (event) => {
        const detail = event.detail || {};
        console.debug('[api_tree] rename_node.jstree', detail);
        this.dispatchNode(detail.node || null, 'rename_node', detail);

        if (detail.node?.id && this.pendingParentByNodeId.has(String(detail.node.id))) {
            const name = (detail.text || detail.node.text || '').trim();
            const oldName = (detail.old || '').trim();
            const pendingName = this.pendingDraftNameByNodeId.get(String(detail.node.id)) || '';

            if (!name) {
                const tree = getTree(this.ajaxTarget);
                if (tree) {
                    tree.delete_node(detail.node);
                }
                this.pendingParentByNodeId.delete(String(detail.node.id));
                this.pendingDraftNameByNodeId.delete(String(detail.node.id));
                this.notify('api_tree: create cancelled');
                return;
            }

            if (name === oldName && name !== pendingName) {
                return;
            }

            const parentId = this.pendingParentByNodeId.get(String(detail.node.id)) || '#';
            this.persistCreate({ ...detail, parent: parentId }).catch((error) => {
                this.notify(`api_tree: create failed (${error.message})`);
            });
            return;
        }

        this.persistRename(detail).catch((error) => {
            this.notify(`api_tree: rename failed (${error.message})`);
        });
    }

    onMoveNode = (event) => {
        const detail = event.detail || {};
        console.debug('[api_tree] move_node.jstree', detail);
        this.dispatchNode(detail.node || null, 'move_node', detail);

        if (detail.node?.id && this.pendingParentByNodeId.has(String(detail.node.id))) {
            this.pendingParentByNodeId.set(String(detail.node.id), String(detail.parent || '#'));
            this.notify('api_tree: moved unsaved node locally');
            return;
        }

        this.persistMove(detail).catch((error) => {
            this.notify(`api_tree: move failed (${error.message})`);
        });
    }

    onDeleteNode = (event) => {
        const detail = event.detail || {};
        console.debug('[api_tree] delete_node.jstree', detail);
        this.dispatchNode(detail.node || null, 'delete_node', detail);

        if (detail.node?.id && this.pendingParentByNodeId.has(String(detail.node.id))) {
            this.pendingParentByNodeId.delete(String(detail.node.id));
            this.pendingDraftNameByNodeId.delete(String(detail.node.id));
            this.notify('api_tree: unsaved node deleted');
            return;
        }

        this.persistDelete(detail).catch((error) => {
            this.notify(`api_tree: delete failed (${error.message})`);
        });
    }

    async persistCreate(detail) {
        const node = detail.node;
        if (!node) {
            return;
        }

        this.pendingCreates.add(node.id);

        try {
            const parentId = this.pendingParentByNodeId.get(String(node.id)) || detail.parent || node.parent || '#';
            const parentIri = this.resolveParentIri(parentId);
            console.info('[api_tree] create parent resolution', {
                nodeId: node.id,
                nodeText: node.text,
                detailParent: detail.parent,
                nodeParent: node.parent,
                chosenParentId: parentId,
                parentIri,
            });
            const payload = this.buildCreatePayload(node, parentIri);
            if (!payload) {
                const tree = getTree(this.ajaxTarget);
                if (tree) {
                    tree.delete_node(node);
                }
                this.pendingParentByNodeId.delete(String(node.id));
                this.pendingDraftNameByNodeId.delete(String(node.id));
                return;
            }
            const created = await this.request(this.baseUrl, 'POST', payload);
            console.info('[api_tree] create response', created);

            if (created && typeof created === 'object') {
                node.data = created;
                if (created['@id']) {
                    node.data['@id'] = created['@id'];
                }
                const canonicalId = this.nodeId(created);
                const createdIri = created?.['@id'] || null;
                const tree = getTree(this.ajaxTarget);
                if (tree && canonicalId && canonicalId !== node.id) {
                    this.pendingParentByNodeId.delete(String(node.id));
                    this.pendingParentByNodeId.set(String(canonicalId), parentId);
                    tree.set_id(node, canonicalId);
                }
                if (canonicalId && createdIri) {
                    this.nodeIriById.set(String(canonicalId), String(createdIri));
                }
            }

            this.notify('api_tree: node created');
        } finally {
            this.pendingCreates.delete(node.id);
            this.pendingParentByNodeId.delete(String(node.id));
            this.pendingDraftNameByNodeId.delete(String(node.id));
            this.pendingTypeByNodeId.delete(String(node.id));
        }
    }

    nextChildLabel(parentId) {
        const tree = getTree(this.ajaxTarget);
        if (!tree) {
            return 'child#1';
        }

        const parentNode = tree.get_node(parentId || '#');
        const siblings = (parentNode?.children || [])
            .map((childId) => tree.get_node(childId)?.text || '')
            .filter(Boolean);

        const base = this.baseLabelFromParent(parentNode?.text || 'child');
        let n = 1;
        let candidate = `${base} ${n}`;
        const lower = siblings.map((x) => String(x).toLowerCase());

        while (lower.includes(candidate.toLowerCase())) {
            n += 1;
            candidate = `${base} ${n}`;
        }

        return candidate;
    }

    baseLabelFromParent(parentText) {
        const raw = String(parentText || 'child').trim();
        const cleaned = raw.replace(/\s*#?\d+(?:\.\d+)*\s*$/g, '').trim() || 'child';
        const words = cleaned.split(/\s+/);
        const last = words[words.length - 1];
        words[words.length - 1] = this.singularizeWord(last);
        return words.join(' ');
    }

    singularizeWord(word) {
        if (!word) {
            return 'child';
        }

        if (/ies$/i.test(word) && word.length > 3) {
            return word.replace(/ies$/i, 'y');
        }

        if (/s$/i.test(word) && !/ss$/i.test(word) && word.length > 1) {
            return word.replace(/s$/i, '');
        }

        return word;
    }

    async persistRename(detail) {
        const node = detail.node;
        if (!node) {
            return;
        }

        if (this.pendingCreates.has(node.id)) {
            return;
        }

        const iri = this.resolveNodeIri(node);
        if (!iri) {
            return;
        }

        const name = detail.text || node.text || '';
        if (!name) {
            return;
        }

        await this.request(iri, 'PATCH', { name });
        this.notify('api_tree: node renamed');
    }

    async persistMove(detail) {
        const node = detail.node;
        if (!node) {
            return;
        }

        if (this.pendingCreates.has(node.id)) {
            return;
        }

        const iri = this.resolveNodeIri(node);
        if (!iri) {
            return;
        }

        const parentId = this.extractMoveParentId(detail);
        const parentIri = this.resolveParentIri(parentId);
        console.info('[api_tree] move parent resolution', {
            nodeId: node.id,
            detailParent: detail.parent,
            nodeParent: node.parent,
            chosenParentId: parentId,
            parentIri,
        });
        await this.request(iri, 'PATCH', { parent: parentIri });
        this.notify('api_tree: node moved');
    }

    extractMoveParentId(detail) {
        if (detail && detail.parent !== undefined && detail.parent !== null && detail.parent !== '') {
            return detail.parent;
        }

        if (detail?.node?.parent !== undefined && detail.node.parent !== null && detail.node.parent !== '') {
            return detail.node.parent;
        }

        const tree = getTree(this.ajaxTarget);
        if (tree && detail?.node?.id) {
            const liveNode = tree.get_node(detail.node.id);
            if (liveNode?.parent !== undefined && liveNode.parent !== null && liveNode.parent !== '') {
                return liveNode.parent;
            }
        }

        return '#';
    }

    async persistDelete(detail) {
        const node = detail.node;
        if (!node) {
            return;
        }

        const iri = this.resolveNodeIri(node);
        if (!iri) {
            return;
        }

        await this.request(iri, 'DELETE');
        this.notify('api_tree: node deleted');
    }

    resolveNodeIri(node) {
        if (!node) {
            return null;
        }

        if (node.data && node.data['@id']) {
            return node.data['@id'];
        }

        if (this.nodeIriById.has(String(node.id))) {
            return this.nodeIriById.get(String(node.id));
        }

        const tree = getTree(this.ajaxTarget);
        if (!tree) {
            return null;
        }

        const liveNode = tree.get_node(node.id);
        if (liveNode?.data?.['@id']) {
            return liveNode.data['@id'];
        }

        return this.inferItemIri(node.id);
    }

    resolveParentIri(parentId) {
        if (!parentId || parentId === '#') {
            console.warn('[api_tree] resolveParentIri root/null parent', { parentId });
            return null;
        }

        const tree = getTree(this.ajaxTarget);
        if (!tree) {
            return null;
        }

        const parentNode = tree.get_node(parentId);
        if (parentNode?.data?.['@id']) {
            console.debug('[api_tree] parent @id from node data', {
                parentId,
                iri: parentNode.data['@id'],
                parentNode,
            });
            return parentNode.data['@id'];
        }

        if (this.nodeIriById.has(String(parentId))) {
            const iri = this.nodeIriById.get(String(parentId));
            console.debug('[api_tree] parent @id from lookup map', { parentId, iri });
            return iri;
        }

        const inferred = this.inferItemIri(parentId);
        console.warn('[api_tree] parent @id missing, using inferred IRI', {
            parentId,
            inferred,
            parentNode,
        });

        return inferred;
    }

    inferItemIri(nodeId) {
        if (!nodeId || nodeId === '#') {
            return null;
        }

        if (this.itemApiPatternValue) {
            return this.itemApiPatternValue.replace('0000000000000000', encodeURIComponent(String(nodeId)));
        }

        const base = this.itemBaseUrl();
        if (!base) {
            return null;
        }

        return `${base}/${encodeURIComponent(String(nodeId))}`;
    }

    itemBaseUrl() {
        const first = this.firstLoadedNode || {};
        if (first['@id']) {
            const iri = String(first['@id']);
            if (!iri.includes('/subtree')) {
                const idx = iri.lastIndexOf('/');
                if (idx > 0) {
                    return iri.slice(0, idx);
                }
            }
        }

        return this.detailBaseUrl() || this.collectionBaseUrl();
    }

    detailBaseUrl() {
        const base = this.collectionBaseUrl();
        if (!base) {
            return null;
        }

        const subtreeIdx = base.indexOf('/subtree');
        if (subtreeIdx > 0) {
            return base.slice(0, subtreeIdx);
        }

        return base;
    }

    collectionBaseUrl() {
        try {
            const url = new URL(this.baseUrl, window.location.origin);
            return url.pathname.replace(/\/+$/, '');
        } catch {
            return String(this.baseUrl || '').split('?')[0].replace(/\/+$/, '');
        }
    }

    buildCreatePayload(node, parentIri) {
        const first = this.firstLoadedNode || {};
        const name = node.text || 'New node';

        // Pick up the instanceType chosen from the context menu (if any).
        const instanceType = this.pendingTypeByNodeId.get(String(node.id)) ?? null;

        if ('code' in first) {
            const code = this.nextUniqueCode(name);

            const payload = {
                code,
                name,
                description: name,
                parent: parentIri,
            };

            if (instanceType) {
                payload.instanceType = instanceType;
            }

            if (this.filterObj?.tenantId) {
                payload.tenantId = String(this.filterObj.tenantId);
            }

            return payload;
        }

        if ('isDir' in first) {
            const payload = {
                name,
                isDir: true,
                parent: parentIri,
            };

            if (this.filterObj?.tenantId) {
                payload.tenantId = String(this.filterObj.tenantId);
            }

            return payload;
        }

        const payload = {
            name,
            parent: parentIri,
        };

        if (this.filterObj?.tenantId) {
            payload.tenantId = String(this.filterObj.tenantId);
        }

        return payload;
    }

    slug(text) {
        return String(text)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    nextUniqueCode(name) {
        const tree = getTree(this.ajaxTarget);
        const allIds = new Set(((tree?.get_json('#', { flat: true }) || []).map((n) => String(n.id).toUpperCase())));

        const baseRaw = (this.slug(name).replace(/-/g, '').slice(0, 10) || 'NODE').toUpperCase();
        let candidate = baseRaw;
        let i = 1;

        while (allIds.has(candidate)) {
            const suffix = String(i);
            const head = baseRaw.slice(0, Math.max(1, 10 - suffix.length));
            candidate = `${head}${suffix}`;
            i += 1;
        }

        return candidate;
    }

    async request(url, method, body = null) {
        console.info('[api_tree] API request', { method, url, body });
        const options = {
            method,
            headers: {
                Accept: 'application/ld+json, application/json',
            },
        };

        if (body !== null) {
            options.headers['Content-Type'] = method === 'PATCH' ? 'application/merge-patch+json' : 'application/ld+json';
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);
        console.info('[api_tree] API response meta', {
            method,
            url,
            status: response.status,
            ok: response.ok,
        });
        if (!response.ok) {
            const text = await response.text();
            console.error('[api_tree] API error response body', { method, url, text });
            throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
        }

        if (response.status === 204) {
            return null;
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json') || contentType.includes('application/ld+json')) {
            return response.json();
        }

        return null;
    }

    async renderSelectedContent(treeNode) {
        if (!this.hasContentTarget || !treeNode) {
            return;
        }

        const node = treeNode?.data || treeNode;
        const record = await this.fetchNodeRecord(treeNode);

        let html = this.defaultContentHtml(node, record);
        const hasContentBlock = this.hasCompiledBlock('api_tree_content');
        if (this._twigEngine && hasContentBlock) {
            html = this._twigEngine.renderBlock('api_tree_content', {
                node,
                record,
                item: record,
                hydra: record,
                globals: this.globalsObj,
            });
        } else {
            console.debug('[api_tree] fallback content used', {
                nodeId: node?.id ?? null,
                sourceBlocks: Object.keys(this._tpl?.__sources__ || {}),
                hasContentBlock,
            });
        }

        this.contentTarget.innerHTML = html;
    }

    async fetchNodeRecord(treeNode) {
        const node = treeNode?.data || treeNode?.original?.data || treeNode;
        const nodeId = node?.id || treeNode?.id || null;
        const rawIri = node?.['@id']
            || treeNode?.data?.['@id']
            || treeNode?.original?.data?.['@id']
            || treeNode?.original?.['@id']
            || (nodeId && this.nodeIriById.has(String(nodeId)) ? this.nodeIriById.get(String(nodeId)) : null)
            || null;
        const iri = this.normalizeItemIri(rawIri, nodeId);
        console.debug('[api_tree] fetchNodeRecord', {
            nodeId,
            rawIri,
            iri,
            node,
            treeNode,
            mapIri: nodeId ? this.nodeIriById.get(String(nodeId)) ?? null : null,
        });
        if (!iri) {
            return node;
        }

        const key = String(iri);
        if (this.recordCache.has(key)) {
            return this.recordCache.get(key);
        }

        const record = await this.request(key, 'GET');
        this.recordCache.set(key, record ?? node);
        return record ?? node;
    }

    normalizeItemIri(rawIri, nodeId) {
        if (typeof rawIri === 'string' && rawIri !== '') {
            if (rawIri.startsWith('/') || rawIri.startsWith('http://') || rawIri.startsWith('https://')) {
                return rawIri;
            }
        }

        return this.inferItemIri(nodeId);
    }

    defaultContentHtml(node, record) {
        const item = record || node || {};
        const title = this.escapeHtml(item.title ?? item.name ?? item.code ?? item.id ?? 'Untitled');
        const type = this.escapeHtml(item.instanceType ?? item.type ?? 'node');
        const id = this.escapeHtml(item.id ?? '');
        const code = this.escapeHtml(item.code ?? '');

        return `
            <div class="card mt-2">
                <div class="card-body">
                    <div class="fw-semibold">${title}</div>
                    <div class="small text-muted">${type}${code ? ` · ${code}` : ''}${id ? ` · ${id}` : ''}</div>
                </div>
            </div>`;
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    dispatchNode(node, msg = 'changed', detail = {}) {
        const data = node && node.data ? node.data : node;
        const payload = {
            msg,
            data,
            node,
            original: detail,
            hydra: data,
        };
        window.dispatchEvent(new CustomEvent('apitree_changed', { detail: payload }));
    }
}

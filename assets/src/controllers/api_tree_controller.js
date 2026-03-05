import { Controller } from '@hotwired/stimulus';
import { createTree, getTree, destroyTree } from '../jstree_runtime.js';

export default class extends Controller {
    static targets = ['ajax', 'message'];

    static values = {
        apiCall: { type: String, default: '' },
        labelField: { type: String, default: 'name' },
        filter: { type: String, default: '{}' },
        plugins: { type: Array, default: ['search', 'types', 'dnd', 'contextmenu'] },
        types: { type: Object, default: {} },
        editable: { type: Boolean, default: true },
    };

    async connect() {
        this.baseUrl = this.apiCallValue;
        this.filterObj = this.parseFilter(this.filterValue);
        this.pendingCreates = new Set();
        this.pendingParentByNodeId = new Map();
        this.boundTreeHandlers = [];
        this.notify(`api_tree: ${this.baseUrl}`);
        console.info('[api_tree] connect', {
            apiCall: this.baseUrl,
            editable: this.editableValue,
            plugins: this.pluginsValue,
        });

        if (!this.hasAjaxTarget || !this.baseUrl) {
            return;
        }

        await this.renderTree();
    }

    disconnect() {
        if (this.hasAjaxTarget) {
            this.unbindTreeEvents();
            destroyTree(this.ajaxTarget);
        }
    }

    async renderTree() {
        const members = await this.fetchAllNodes();
        const data = this.toJsTreeData(members);

        this.ajaxTarget.innerHTML = '';
        createTree(this.ajaxTarget, {
            plugins: this.pluginsValue,
            core: {
                data,
                check_callback: this.editableValue,
                themes: {
                    name: false,
                    url: false,
                    dots: false,
                    icons: true,
                },
            },
            types: this.typesValue,
            contextmenu: this.editableValue ? {
                items: (node) => ({
                    create: {
                        label: 'Add child',
                        action: () => {
                            const tree = getTree(this.ajaxTarget);
                            if (!tree) {
                                return;
                            }
                            const created = tree.create_node(node.id, { text: 'New node' }, 'last');
                            if (created) {
                                this.pendingParentByNodeId.set(String(created), String(node.id));
                                tree.edit(created);
                            }
                        },
                    },
                    rename: {
                        label: 'Rename',
                        action: () => {
                            const tree = getTree(this.ajaxTarget);
                            if (!tree) {
                                return;
                            }
                            tree.edit(node);
                        },
                    },
                    remove: {
                        label: 'Delete',
                        action: () => {
                            const tree = getTree(this.ajaxTarget);
                            if (!tree) {
                                return;
                            }
                            tree.delete_node(node);
                        },
                    },
                }),
            } : {},
        });

        this.bindTreeEvents();
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

    async fetchAllNodes() {
        const url = new URL(this.baseUrl, window.location.origin);
        Object.entries(this.filterObj).forEach(([k, v]) => {
            if (v !== null && v !== undefined && v !== '') {
                url.searchParams.set(k, String(v));
            }
        });

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
        this.notify(`api_tree: loaded ${members.length} nodes`);
        return members;
    }

    toJsTreeData(members) {
        return members.map((node) => {
            const id = this.nodeId(node);
            const parent = this.nodeParent(node);
            const isDir = node.isDir === true;

            return {
                id,
                parent,
                text: this.nodeLabel(node),
                icon: isDir ? 'bi bi-folder2-open' : 'bi bi-file-earmark',
                type: isDir ? 'dir' : 'file',
                data: node,
            };
        });
    }

    nodeId(node) {
        if (node.code !== undefined && node.code !== null && node.code !== '') {
            return String(node.code);
        }
        if (node.id !== undefined && node.id !== null && node.id !== '') {
            return String(node.id);
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
        return node[this.labelFieldValue] ?? node.name ?? node.title ?? this.nodeId(node);
    }

    search(event) {
        const term = (event.currentTarget?.value || '').trim();
        const tree = getTree(this.ajaxTarget);
        if (tree) {
            tree.search(term);
        }
    }

    clearSearch() {
        const tree = getTree(this.ajaxTarget);
        if (tree) {
            tree.clear_search();
        }
    }

    bindTreeEvents() {
        this.unbindTreeEvents();

        const listeners = [
            [['changed.jstree', 'jstree:changed'], this.onChanged],
            [['select_node.jstree', 'jstree:select_node'], this.onSelectNode],
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
                console.debug('[api_tree] bound DOM event', eventName);
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
        const nodeId = tree.create_node(parent, { text: 'New node' }, 'last');
        if (!nodeId) {
            return;
        }

        this.pendingParentByNodeId.set(String(nodeId), String(parent));

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
        this.dispatchNode(detail.node || null, 'select_node', detail);
    }

    onCreateNode = (event) => {
        const detail = event.detail || {};
        console.debug('[api_tree] create_node.jstree', detail);
        this.dispatchNode(detail.node || null, 'create_node', detail);
        this.persistCreate(detail).catch((error) => {
            this.notify(`api_tree: create failed (${error.message})`);
        });
    }

    onRenameNode = (event) => {
        const detail = event.detail || {};
        console.debug('[api_tree] rename_node.jstree', detail);
        this.dispatchNode(detail.node || null, 'rename_node', detail);
        this.persistRename(detail).catch((error) => {
            this.notify(`api_tree: rename failed (${error.message})`);
        });
    }

    onMoveNode = (event) => {
        const detail = event.detail || {};
        console.debug('[api_tree] move_node.jstree', detail);
        this.dispatchNode(detail.node || null, 'move_node', detail);
        this.persistMove(detail).catch((error) => {
            this.notify(`api_tree: move failed (${error.message})`);
        });
    }

    onDeleteNode = (event) => {
        const detail = event.detail || {};
        console.debug('[api_tree] delete_node.jstree', detail);
        this.dispatchNode(detail.node || null, 'delete_node', detail);
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
            console.debug('[api_tree] create payload parent', { nodeId: node.id, parentId, parentIri });
            const payload = this.buildCreatePayload(node, parentIri);
            if (!payload) {
                const tree = getTree(this.ajaxTarget);
                if (tree) {
                    tree.delete_node(node);
                }
                this.pendingParentByNodeId.delete(String(node.id));
                return;
            }
            const created = await this.request(this.baseUrl, 'POST', payload);

            if (created && typeof created === 'object') {
                node.data = created;
                if (created['@id']) {
                    node.data['@id'] = created['@id'];
                }
                const canonicalId = this.nodeId(created);
                const tree = getTree(this.ajaxTarget);
                if (tree && canonicalId && canonicalId !== node.id) {
                    this.pendingParentByNodeId.delete(String(node.id));
                    this.pendingParentByNodeId.set(String(canonicalId), parentId);
                    tree.set_id(node, canonicalId);
                }
            }

            this.notify('api_tree: node created');
        } finally {
            this.pendingCreates.delete(node.id);
            this.pendingParentByNodeId.delete(String(node.id));
        }
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

        const parentIri = this.resolveParentIri(detail.parent);
        await this.request(iri, 'PATCH', { parent: parentIri });
        this.notify('api_tree: node moved');
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
            return null;
        }

        const tree = getTree(this.ajaxTarget);
        if (!tree) {
            return null;
        }

        const parentNode = tree.get_node(parentId);
        if (parentNode?.data?.['@id']) {
            return parentNode.data['@id'];
        }

        return this.inferItemIri(parentId);
    }

    inferItemIri(nodeId) {
        if (!nodeId || nodeId === '#') {
            return null;
        }

        const base = this.collectionBaseUrl();
        if (!base) {
            return null;
        }

        return `${base}/${encodeURIComponent(String(nodeId))}`;
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

        if ('code' in first) {
            const suggested = (this.slug(name).replace(/-/g, '').slice(0, 10) || `n${Date.now().toString().slice(-8)}`).toUpperCase();
            const entered = window.prompt('Enter topic code (max 10 chars)', suggested);
            if (!entered) {
                this.notify('api_tree: create cancelled');
                return null;
            }
            const code = entered.trim().slice(0, 10);
            if (!code) {
                this.notify('api_tree: code is required');
                return null;
            }

            const tree = getTree(this.ajaxTarget);
            if (tree) {
                const allNodes = tree.get_json('#', { flat: true }) || [];
                const duplicate = allNodes.some((n) => String(n.id) === code);
                if (duplicate) {
                    this.notify(`api_tree: code "${code}" already exists`);
                    return null;
                }
            }

            return {
                code,
                name,
                description: name,
                parent: parentIri,
            };
        }

        if ('isDir' in first) {
            return {
                name,
                isDir: true,
                parent: parentIri,
            };
        }

        return {
            name,
            parent: parentIri,
        };
    }

    slug(text) {
        return String(text)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    async request(url, method, body = null) {
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
        if (!response.ok) {
            const text = await response.text();
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

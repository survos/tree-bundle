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
        this.pendingDraftNameByNodeId = new Map();
        this.pendingTypeByNodeId = new Map();
        this.nodeIriById = new Map();
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
                            label: 'Add child',
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
                        separator_before: true,
                        label: 'Rename',
                        action: () => {
                            const tree = getTree(this.ajaxTarget);
                            if (!tree) return;
                            tree.edit(node);
                        },
                    };
                    items.remove = {
                        label: 'Delete',
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
        console.info('[api_tree] fetch URL', url.toString());

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

            // Append image count badge when available and non-zero.
            const imageCount = node.imageCount ?? node.image_count ?? null;
            const label = this.nodeLabel(node);
            const text = (imageCount != null && imageCount > 0)
                ? `${label} <span class="jstree-img-count">${imageCount}</span>`
                : label;

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
            [['jstree:changed'], this.onChanged],
            [['jstree:select_node'], this.onSelectNode],
        ];

        if (this.editableValue) {
            listeners.push([['jstree:create_node'], this.onCreateNode]);
            listeners.push([['jstree:rename_node'], this.onRenameNode]);
            listeners.push([['jstree:move_node'], this.onMoveNode]);
            listeners.push([['jstree:delete_node'], this.onDeleteNode]);
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
        this.dispatchNode(detail.node || null, 'select_node', detail);
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
            const idx = iri.lastIndexOf('/');
            if (idx > 0) {
                return iri.slice(0, idx);
            }
        }

        return this.collectionBaseUrl();
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

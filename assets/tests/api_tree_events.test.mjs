import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Load the actual controller with browser-only dependencies replaced by test doubles.
const source = (await readFile(new URL('../src/controllers/api_tree_controller.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '')
    .replace('export default class', 'class ApiTreeController');
function controller() {
    const tree = { set_id(node, id) { node.id = id; } };
    const Controller = vm.runInNewContext(`${source}\nApiTreeController`, {
        Controller: class {}, getTree: () => tree, console: { debug() {}, info() {} },
    });
    const instance = new Controller();
    Object.assign(instance, {
        ajaxTarget: new EventTarget(), editableValue: true, boundTreeHandlers: [],
        pendingCreates: new Set(), pendingParentByNodeId: new Map(),
        pendingDraftNameByNodeId: new Map(), pendingTypeByNodeId: new Map(), nodeIriById: new Map(),
        notify() {}, dispatchNode() {}, resolveParentIri: () => '/api/locations/1',
        buildCreatePayload: node => ({ name: node.text }), nodeId: record => String(record.id),
    });
    return instance;
}
function emit(target, name, detail) {
    const event = new Event(name);
    Object.defineProperty(event, 'detail', { value: detail });
    target.dispatchEvent(event);
}

test('runtime aliases cause one write per mutation, including after rebinding', async () => {
    const c = controller();
    const writes = [];
    c.request = async (url, method) => { writes.push(method); return { id: 42, '@id': '/api/locations/42' }; };
    c.resolveNodeIri = () => '/api/locations/42';
    c.bindTreeEvents();
    c.bindTreeEvents();
    const node = { id: 'draft', text: 'Shelf', parent: '1' };
    for (const event of ['create_node', 'rename_node']) {
        const detail = { node, parent: '1', text: 'Shelf', old: 'New' };
        emit(c.ajaxTarget, `${event}.jstree`, detail);
        emit(c.ajaxTarget, `jstree:${event}`, detail);
        if (event === 'create_node') {
            assert.equal(writes.length, 0, 'adding a local draft does not POST before name confirmation');
        }
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(writes, ['POST']);
    assert.equal(c.pendingCreates.size, 0);
    assert.equal(c.pendingDraftNameByNodeId.size, 0);
    for (const event of ['rename_node', 'move_node', 'delete_node']) {
        const detail = { node, parent: '1', text: 'Renamed' };
        emit(c.ajaxTarget, `${event}.jstree`, detail);
        emit(c.ajaxTarget, `jstree:${event}`, detail);
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(writes, ['POST', 'PATCH', 'PATCH', 'DELETE']);
    c.unbindTreeEvents();
    emit(c.ajaxTarget, 'delete_node.jstree', { node });
    assert.equal(writes.length, 4);
});

test('overlapping saves share one POST and clear draft state after canonical ID replacement', async () => {
    const c = controller();
    const node = { id: 'draft', text: 'Shelf', parent: '1' };
    c.pendingParentByNodeId.set('draft', '1');
    c.pendingDraftNameByNodeId.set('draft', 'New');
    c.pendingTypeByNodeId.set('draft', 'shelf');
    let resolveRequest;
    let calls = 0;
    c.request = () => { calls++; return new Promise(resolve => { resolveRequest = resolve; }); };
    const first = c.persistCreate({ node });
    await c.persistCreate({ node });
    assert.equal(calls, 1);
    resolveRequest({ id: 42, '@id': '/api/locations/42' });
    await first;
    assert.equal(node.id, '42');
    for (const state of [c.pendingCreates, c.pendingParentByNodeId, c.pendingDraftNameByNodeId, c.pendingTypeByNodeId]) {
        assert.equal(state.size, 0);
    }
});

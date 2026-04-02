import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksToTwigSource, sourceFromScriptContent } from '../src/lib/twig_block_registry.mjs';

test('blocksToTwigSource renders string payload blocks', () => {
    const source = blocksToTwigSource({
        nodeLabel: '{{ node.name }}',
    });

    assert.equal(source, '<twig:block name="nodeLabel">{{ node.name }}</twig:block>');
});

test('blocksToTwigSource supports object payload blocks with html key', () => {
    const source = blocksToTwigSource({
        api_tree_content: { html: '{% set item = record ?? node %}' },
    });

    assert.equal(source, '<twig:block name="api_tree_content">{% set item = record ?? node %}</twig:block>');
});

test('sourceFromScriptContent converts JSON block registry to twig:block source', () => {
    const source = sourceFromScriptContent(JSON.stringify({
        nodeLabel: '{{ node.name }}',
        api_tree_content: { html: '{{ record.id }}' },
    }));

    assert.equal(
        source,
        '<twig:block name="nodeLabel">{{ node.name }}</twig:block>\n<twig:block name="api_tree_content">{{ record.id }}</twig:block>'
    );
});

test('sourceFromScriptContent returns literal twig:block source unchanged', () => {
    const raw = '<twig:block name="nodeLabel">{{ node.name }}</twig:block>';
    assert.equal(sourceFromScriptContent(raw), raw);
});

test('sourceFromScriptContent throws on malformed JSON payload', () => {
    assert.throws(() => sourceFromScriptContent('{not valid json}'));
});

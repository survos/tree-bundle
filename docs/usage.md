# Tree Bundle Usage Guide

This guide is optimized for both humans and AI coding agents.

## 1) Pick the right component

- Use `apiTreeBrowser` when data comes from ApiPlatform.
- Use `tree` controller/tag for static/in-memory trees.

## 2) Required inputs for `apiTreeBrowser`

At minimum, provide either:

- `:apiUrl="'/api/...collection...'"`, or
- `:resourceClass="App\\Entity\\Foo::class"`

And provide `:caller="_self"` when embedding `<twig:block>` children.

## 3) JS/Twig runtime dependencies

To use embedded twig blocks in the browser:

- `@tacman1123/twig-browser`
- `@tacman1123/twig-browser/adapters/symfony`
- `@tacman1123/twig-browser/src/compat/compileTwigBlocks.js`
- `@survos/js-twig/generated/fos_routes.js`

Without these, client-side block rendering cannot resolve Twig functions like `path()`.

## 4) Example with tenant filtering

```twig
{% set globals = { tenantId: tenantId, canWrite: canWrite } %}

<twig:apiTreeBrowser
    :resourceClass="entityClass"
    :apiUrl="treeApiUrl"
    :filter="{ tenantId: tenantId }"
    :globals="globals"
    :editable="canWrite"
    :openAll="true"
    :selectFirst="false"
    :caller="_self"
    style="plain"
    browserClass="my-tree-layout"
    treePaneClass="my-tree-pane"
    contentPaneClass="my-content-pane"
>
    <twig:block name="nodeLabel">
        {{ node.title ?? node.name ?? node.code ?? node.id }}
    </twig:block>

    <twig:block name="api_tree_content">
        {% set item = record ?? node %}
        {% set params = { tenantId: globals.tenantId, instanceId: item.id } %}
        <a href="{{ path('instance_browse', params) }}">Browse</a>
    </twig:block>
</twig:apiTreeBrowser>
```

## 5) Event model

The controller listens to native events emitted by jsTree:

- `changed.jstree`
- `select_node.jstree`
- `create_node.jstree`
- `rename_node.jstree`
- `move_node.jstree`
- `delete_node.jstree`

App-level integrations can listen to:

- `window` event: `apitree_changed`

## 6) Editing/persistence behavior

- Create: local placeholder first, then persisted on rename confirm.
- Move: PATCH with `parent` IRI.
- Rename: PATCH with new name/title field mapping.
- Delete: DELETE item endpoint.

## 7) Common mistakes

- Using `tenantId` directly in browser twig block instead of `globals.tenantId`.
- Pointing browser to unscoped collection endpoint for tenant data.
- Missing js-twig route generator importmap entry.

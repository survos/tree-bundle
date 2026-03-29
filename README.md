# Survos Tree Bundle

Tree UI + API editing for Symfony UX Twig Components.

This bundle provides:

- `apiTreeBrowser` / `api_tree` Twig components (jsTree-backed)
- `@survos/tree-bundle/api_tree` Stimulus controller
- `{% tree %}` Twig tag for recursive rendering

## Install

```bash
composer require survos/tree-bundle
```

## Required JS modules (important)

`apiTreeBrowser` can render embedded Twig blocks in the browser. For this to work reliably, your importmap must include:

- `@tacman1123/twig-browser`
- `@tacman1123/twig-browser/adapters/symfony`
- `@tacman1123/twig-browser/src/compat/compileTwigBlocks.js`
- `@survos/js-twig/generated/fos_routes.js` (for `path()` in client-side twig)

If these are missing or incompatible, the controller now fails fast with a clear error instead of silently falling back.

## Minimal Example

```twig
<twig:apiTreeBrowser
    :resourceClass="topicClass"
    :filter="{ tenantId: tenant.code }"
    :editable="true"
    :openAll="true"
    :caller="_self"
>
    <twig:block name="nodeLabel">
        {{ node.name ?? node.title ?? node.code ?? node.id }}
    </twig:block>

    <twig:block name="api_tree_content">
        {% set item = record ?? node %}
        <h5>{{ item.name ?? item.title ?? item.id }}</h5>
    </twig:block>
</twig:apiTreeBrowser>
```

## Variables available inside client-side Twig blocks

Inside `nodeLabel` / `api_tree_content`, these render vars are available:

- `node` - selected jsTree node payload
- `record` - full fetched API record for selected node
- `item` - alias of `record ?? node`
- `hydra` - alias of `item`
- `globals` - values passed from component `:globals="..."`

If you pass tenant info via globals, reference `globals.tenantId` (not `tenantId` directly).

Example:

```twig
{% set params = { tenantId: globals.tenantId, instanceId: item.id } %}
<a href="{{ path('instance_browse', params) }}">Browse</a>
```

## Styling hooks (Tabler/Bootstrap/custom)

Use component class options:

- `browserClass`
- `treePaneClass`
- `contentPaneClass`
- `style="plain"` to avoid the built-in bootstrap grid wrapper

Wrapper includes `api-tree-browser--themeable` for easy theming.

Example:

```twig
<twig:apiTreeBrowser
    style="plain"
    browserClass="my-tree-layout"
    treePaneClass="my-tree-column"
    contentPaneClass="my-content-column"
    ...
/>
```

## Toolbar buttons

Built-in toolbar includes search and clear.

Optional slideshow button appears when you pass:

```twig
:globals="{ slideshowUrl: '/my/slideshow/url' }"
```

## API controller defaults

Bundle config now supports separate controllers:

```yaml
survos_tree:
  tree_stimulus_controller: '@survos/tree-bundle/tree'
  api_tree_stimulus_controller: '@survos/tree-bundle/api_tree'
```

Legacy `stimulus_controller` is deprecated.

## Performance behavior

- Tree list loads from collection endpoint once.
- Full detail `GET {id}` fetch happens on explicit node selection.
- Label rendering uses already-loaded collection data.

## Troubleshooting

- Error: `Twig function path is not configured`
  - Ensure `@survos/js-twig/generated/fos_routes.js` is mapped in importmap.
  - Ensure `var/js_twig_bundle/generated/fos_routes.js` exists (cache warmer).
  - Ensure `@tacman1123/twig-browser`, `@tacman1123/twig-browser/adapters/symfony`, and `@tacman1123/twig-browser/src/compat/compileTwigBlocks.js` are mapped.

- Detail block cannot see `tenantId`
  - Use `globals.tenantId` unless you explicitly flatten into top-level context.

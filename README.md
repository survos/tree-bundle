# Survos Tree Bundle

Working with hierarchical data can get complex quickly.  Fortunately, there are tools to help.  This bundle wraps 3 amazing tools together.

* a {% tree %} twig tag for recursively displaying a tree without writing a twig macro
Wrapper for jstree using ApiPlatform.  Also includes a {% tree %} twig tag.
* A stimulus controller that calls the jstree javascript library
* Some helpers to integrate with ApiPlatform for editing and creating tree nodes.

## ApiTree default controller

The `api_tree` Twig component should use the API controller by default:

- `@survos/tree-bundle/api_tree`

If an app overrides bundle config, set it explicitly:

```yaml
survos_tree:
  stimulus_controller: '@survos/tree-bundle/api_tree'
```

## jsTree plugins in this bundle

jsTree's built-in plugins are included in the main jsTree distribution, so you do not install each plugin separately.

Common built-ins include:

- `search`
- `checkbox`
- `types`
- `sort`
- `state`
- `dnd`
- `contextmenu`
- `wholerow`

The default `tree_controller` now enables `search` by default (`checkbox`, `search`, `types`, `sort`).

### Which plugins use AJAX?

- `search`: only if you configure `search.ajax`
- `massload`: yes (by design)
- most others are client-side only

In addition to the above, the has a dependency on stof/doctrine-extensions-bundle to make doctrine entities hierarchical.

```bash
composer req survos/tree-bundle
```

## Tree Tag

The `{% tree %}` tag works almost like `{% for %}`, but inside a `{% tree %}` you can call `{% subtree var %}`  See more details at tacman/tree-tag.

```twig

{% tree item in menu %}
  {% if treeloop.first %}<ul>{% endif %}
    <li>
        <a href="{{ item.url }}">{{ item.name }}</a>
        {% subtree item.children %}
    </li>
  {% if treeloop.last %}</ul>{% endif %}
{% endtree %}


```

```bash
symfony new tree-demo --webapp --version=next --php=8.2 && cd tree-demo
composer config minimum-stability dev
composer config extra.symfony.allow-contrib true
composer req symfony/asset-mapper:^6.4 symfony/stimulus-bundle:2.x-dev survos/tree-bundle

bin/console make:controller Tree -i
cat > templates/tree.html.twig <<END
{% extends 'base.html.twig' %}
{% block body %}
    {% set food = [
        {name: 'fruit', children: [
            {name: 'apple', children: [
                {name: 'Granny Smith'},
                {name: 'Gala'},
                {name: 'Fuji'},
            ]},
            {name: 'banana'}
        ]},
        {name: 'veggies', children: [
            {name: 'peas'},
            {name: 'carrots'},
            {name: 'beets'}
        ]},

    ] %}

    <h2>Food Tree</h2>
    {% set _sc = '@survos/tree-bundle/tree' %}
<div {{ stimulus_controller(_sc) }} {{ stimulus_target(_sc, 'html') }}>
    {% tree item in food %}
        {% if treeloop.first %}<ul>{% endif %}
        <li>
            {{ item.name }}
            {% subtree item.children|default([]) %}
        </li>
        {% if treeloop.last %}</ul>{% endif %}
    {% endtree %}
</div>
{% endblock %}

END
symfony server:start -d
symfony open:local --path=/tree
```



## Issue with AutoImport

```json
    "controllers": {
      "tree": {
        "main": "src/controllers/tree_controller.js",
        "webpackMode": "eager",
        "fetch": "lazy",
        "enabled": true,
        "autoimport": {
          "jstree/dist/themes/default/style.min.css": true
        }
      },

```

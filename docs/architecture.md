# Tree Bundle Architecture Notes

## Stored Counts (added 2026-03)

### Problem
Computing `subtreeImageCount` (recursive total of images under a node) at query time
requires either an O(n²) nested-set self-join or an O(n²) PHP loop. Both are wrong.

### Solution
Store `subtreeImageCount` as an `#[ORM\Column]` on the entity via `TreeTrait`.
Compute it once at import time using `TreeTrait::updateSubtreeCounts()`, then serve
it directly from the DB column — zero queries at serve time.

```php
// After import flush, call once per tenant:
Instance::updateSubtreeCounts($nodes); // $nodes = all instances ordered by lft ASC
$em->flush();
```

`updateSubtreeCounts()` is an O(n) forward pass using the nested-set `lft/rgt` values:
- Walk nodes in `lft ASC` order
- Maintain a stack of open ancestors (those whose `rgt > current lft`)
- For each node, add its `imageCount` to all open ancestors

### getChildCount()
`TreeTrait::getChildCount()` now returns the stored Gedmo `$childCount` column
rather than loading the `$children` collection. No collection load needed.

---

## Serialization Groups

### Problem
Symfony's `Default` serialization group auto-discovers ALL public `get*` methods with
no `#[Groups]` annotation. For tree entities this is dangerous because:

- `getTreePath()` walks the parent chain → triggers Doctrine proxy loads for each unique parent = N+1 queries
- `getTreeUrl()` same
- These are never needed in collection/tree API responses

### Solution
- Remove `'Default'` from entity-level `normalizationContext`
- Use explicit groups on every serialized method/property
- Add a `meili` group for expensive computed fields only needed during Meilisearch indexing:

```php
#[Groups(['meili'])]
public function getTreePath(): string { ... }

#[Groups(['meili'])]
public function getTreeUrl(): string { ... }
```

- Entity-level `normalizationContext` should be minimal: `['groups' => ['jstree', 'minimum']]`
- Single-item `Get` operation can have full groups: `['Default', 'jstree', 'minimum', 'marking', 'rp', 'instance:read']`

### AP3 normalizationContext override does NOT work
`OperationDefaultsTrait` merges entity-level groups INTO operation-level groups at
metadata build time (`array_merge($resourceLevel, $operationLevel)`). Setting
`normalizationContext` on a `GetCollection` operation does NOT replace the entity-level
groups — it appends to them. The only reliable fix is narrowing the entity-level context.

### #[Ignore] does NOT work on getter methods in AP3
AP3's `PropertyMetadataLoader` only reads `#[Ignore]` from property reflection,
not method reflection. Ignore on a `get*()` method is silently ignored.

---

## PHP 8.4 Property Hooks (planned)

Require PHP 8.4 in tree-bundle and replace getters with property hooks:

```php
// Instead of:
public function getTreePath(): string { ... }

// Use:
public string $treePath {
    get {
        $parts = [];
        $node = $this;
        while ($node !== null) {
            array_unshift($parts, $node->code ?? (string) $node->id);
            $node = $node->getParent();
        }
        return implode('/', $parts);
    }
}
```

Benefits:
- Virtual properties → `#[Ignore]` works correctly (it's a property, not a method)
- Naturally lazy (computed on access)
- Serializer sees it as a property, not a virtual getter — cleaner metadata

Bloat: need to verify Gedmo compatibility with `$parent`/`$children` as hooked properties
before migrating.

---

## API Collection Performance

For the tenant tree endpoint (`/api/tenants/{tenantId}/instances`):
- One ORM query, ordered by `lft ASC` — all nodes in identity map
- `parentId` resolved via `$this->getParent()?->id` — Doctrine returns identifier
  from proxy without initializing it (identity map hit)
- `subtreeImageCount` served from stored column — no join
- `imageCount` served from stored column (maintained by `ImageCountListener`)
- Total: **1 query** for any size tree

### What to avoid
- `getTreePath()` / `getTreeUrl()` in any collection context — they walk the parent chain
- `SIZE(i.images)` in DQL — N+1
- PHP loops computing subtree counts at serve time

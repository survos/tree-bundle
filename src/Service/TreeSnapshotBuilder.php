<?php

declare(strict_types=1);

namespace Survos\Tree\Service;

use Survos\Tree\Model\ComputedTreeNode;
use Survos\Tree\Model\TreePathNodeInput;

final class TreeSnapshotBuilder
{
    /**
     * @param iterable<TreePathNodeInput> $inputs
     * @return array<string,ComputedTreeNode>
     */
    public function build(iterable $inputs): array
    {
        $nodes = [];
        $childrenByPath = [];
        $roots = [];

        foreach ($inputs as $input) {
            $nodes[$input->path] = $input;
            if ($input->parentPath === null) {
                $roots[] = $input->path;
                continue;
            }
            $childrenByPath[$input->parentPath] ??= [];
            $childrenByPath[$input->parentPath][] = $input->path;
        }

        sort($roots);
        foreach ($childrenByPath as &$children) {
            usort($children, static fn (string $a, string $b): int => strcmp($a, $b));
        }

        $counter = 1;
        $computed = [];
        foreach ($roots as $rootPath) {
            $this->walk($rootPath, null, 0, $nodes, $childrenByPath, $counter, $computed, null);
        }

        return $computed;
    }

    /**
     * @param array<string,TreePathNodeInput> $nodes
     * @param array<string,list<string>> $childrenByPath
     * @param array<string,ComputedTreeNode> $computed
     */
    private function walk(
        string $path,
        ?string $parentId,
        int $level,
        array $nodes,
        array $childrenByPath,
        int &$counter,
        array &$computed,
        ?string $rootId,
    ): void {
        $node = $nodes[$path];
        $left = $counter++;
        $rootId ??= $node->id;

        $children = $childrenByPath[$path] ?? [];
        foreach ($children as $childPath) {
            $this->walk($childPath, $node->id, $level + 1, $nodes, $childrenByPath, $counter, $computed, $rootId);
        }

        $right = $counter++;
        $computed[$path] = new ComputedTreeNode(
            path: $path,
            id: $node->id,
            parentId: $parentId,
            rootId: $rootId,
            code: $node->code,
            title: $node->title,
            type: $node->type,
            level: $level,
            left: $left,
            right: $right,
            childCount: count($children),
            treePath: $path,
            slug: $path,
        );
    }
}

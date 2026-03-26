<?php

declare(strict_types=1);

namespace Survos\Tree\Model;

final class ComputedTreeNode
{
    public function __construct(
        public readonly string $path,
        public readonly string $id,
        public readonly ?string $parentId,
        public readonly string $rootId,
        public readonly string $code,
        public readonly ?string $title,
        public readonly ?string $type,
        public readonly int $level,
        public readonly int $left,
        public readonly int $right,
        public readonly int $childCount,
        public readonly string $treePath,
        public readonly string $slug,
    ) {
    }
}

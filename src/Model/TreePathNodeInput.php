<?php

declare(strict_types=1);

namespace Survos\Tree\Model;

final class TreePathNodeInput
{
    public function __construct(
        public readonly string $path,
        public readonly string $id,
        public readonly ?string $parentPath,
        public readonly string $code,
        public readonly ?string $title = null,
        public readonly ?string $type = null,
    ) {
    }
}

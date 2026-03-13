<?php

namespace Survos\Tree;

use Doctrine\Common\Collections\Collection;

interface TreeInterface
{
    public function getParent(): ?static;

    public function setParent(?TreeInterface $parent): static;

    public function getChildren(): Collection;

    public function addChild(TreeInterface $child): static;

    public function removeChild(TreeInterface $child): static;

    public function getChildCount(): int;

    public function getParentId(): mixed;

    public function getLevel(): int;
}

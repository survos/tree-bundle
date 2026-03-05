<?php

namespace Survos\Tree\Traits;

use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Gedmo\Mapping\Annotation as Gedmo;
use Gedmo\Tree\Traits\NestedSetEntity;
use Survos\Tree\TreeInterface;
use Symfony\Component\Serializer\Attribute\Groups;

trait TreeTrait
{
    use NestedSetEntity;

    #[Gedmo\TreeParent]
    #[ORM\ManyToOne(targetEntity: self::class, inversedBy: 'children')]
    #[ORM\JoinColumn(referencedColumnName: 'id', onDelete: 'CASCADE')]
    public $parent;

    #[ORM\OneToMany(targetEntity: self::class, mappedBy: 'parent')]
    #[ORM\OrderBy(['left' => 'ASC'])]
    public $children;

    #[Gedmo\TreeRoot]
    #[ORM\ManyToOne(targetEntity: self::class)]
    #[ORM\JoinColumn(referencedColumnName: 'id', onDelete: 'CASCADE')]
    private $root;

    #[ORM\Column]
    private int $childCount = 0;

    public function getParent(): ?self
    {
        return $this->parent;
    }

    public function setParent(?TreeInterface $parent): self
    {
        $this->parent = $parent;

        return $this;
    }


    public function getChildren(): Collection
    {
        return $this->children;
    }

    public function addChild(TreeInterface $child): self
    {
        if (! $this->children->contains($child)) {
            $this->children[] = $child;
            $child->setParent($this);
        }

        return $this;
    }

    public function removeChild(TreeInterface $child): self
    {
        if ($this->children->removeElement($child)) {
            // set the owning side to null (unless already changed)
            if ($child->getParent() === $this) {
                $child->setParent(null);
            }
        }

        return $this;
    }

    public function getChildCount(): int
    {
        return $this->getChildren()->count();
    }

    #[Groups(['minimum', 'search', 'jstree'])]
    public function getParentId()
    {
        return $this?->getParent()?->id;
    }

    public function getLevel()
    {
        return $this->level;
    }
}

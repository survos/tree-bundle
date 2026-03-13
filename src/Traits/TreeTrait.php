<?php

namespace Survos\Tree\Traits;

use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Gedmo\Mapping\Annotation as Gedmo;
use Gedmo\Tree\Traits\NestedSetEntity;
use Survos\Tree\TreeInterface;
use Symfony\Component\Serializer\Attribute\Groups;

trait TreeTrait
{
    use NestedSetEntity;

    // NOTE: $parent and $children are intentionally untyped.
    // PHP traits cannot use `static` as a property type hint, and Gedmo's
    // tree listener requires these to be plain public properties it can
    // reflectively set.  Typed as `?static` would be ideal but is unsupported.
    //
    // API PLATFORM NOTE: Do NOT use ApiPlatform's SearchFilter on $parent.
    // SearchFilter resolves associations via IRI, which only works for
    // integer PKs. For string-PK entities (e.g. xxh3 hash IDs) you must
    // filter by the FK column directly:
    //
    //   ->andWhere('IDENTITY(e.parent) = :parentId')
    //   ->setParameter('parentId', $id)
    //
    // getParentId() is exposed in serialization groups for read use.
    // For API Platform collection filtering, add a custom state provider
    // or use a dedicated ?parentId= query param handled via DQL.

    #[Gedmo\TreeParent]
    #[ORM\ManyToOne(targetEntity: self::class, inversedBy: 'children')]
    #[ORM\JoinColumn(referencedColumnName: 'id', onDelete: 'CASCADE')]
    #[Groups(['Default', 'minimum', 'browse', 'jstree'])]
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

    public function getParent(): ?static
    {
        return $this->parent;
    }

    public function setParent(?TreeInterface $parent): static
    {
        $this->parent = $parent;

        return $this;
    }

    public function getChildren(): Collection
    {
        return $this->children ?? new ArrayCollection();
    }

    public function addChild(TreeInterface $child): static
    {
        if (!$this->children->contains($child)) {
            $this->children[] = $child;
            $child->setParent($this);
        }

        return $this;
    }

    public function removeChild(TreeInterface $child): static
    {
        if ($this->children->removeElement($child)) {
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
    public function getParentId(): mixed
    {
        return $this->getParent()?->id;
    }

    public function getLevel(): int
    {
        return $this->level;
    }
}

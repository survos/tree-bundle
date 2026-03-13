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
    #[Groups(['Default', 'browse'])]
    public $parent;

    #[ORM\OneToMany(targetEntity: self::class, mappedBy: 'parent')]
    #[ORM\OrderBy(['left' => 'ASC'])]
    public $children;

    #[Gedmo\TreeRoot]
    #[ORM\ManyToOne(targetEntity: self::class)]
    #[ORM\JoinColumn(referencedColumnName: 'id', onDelete: 'CASCADE')]
    private $root;

    #[ORM\Column()]
    private int $childCount = 0;

    /**
     * Cached recursive total of images in this node and all its descendants.
     * Computed and stored during import; served as-is from the DB at query time.
     */
    #[ORM\Column()]
    #[Groups(['jstree'])]
    public int $subtreeImageCount = 0;

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

    /**
     * Returns the stored child count maintained by Gedmo — no collection load.
     */
    public function getChildCount(): int
    {
        return $this->childCount;
    }

    #[Groups(['minimum', 'search', 'jstree'])]
    public function getParentId(): mixed
    {
        return $this->parent?->id;
    }

    public function getLevel(): int
    {
        return $this->level;
    }

    public function getSubtreeImageCount(): int
    {
        return $this->subtreeImageCount;
    }

    public function setSubtreeImageCount(int $count): static
    {
        $this->subtreeImageCount = $count;
        return $this;
    }

    /**
     * Compute and store subtreeImageCount for every node in a flat array
     * of entities already ordered by lft (i.e. the full tree in nested-set order).
     *
     * Uses a single O(n) reverse pass — process leaves first, propagate up.
     * No SQL join, no extra queries needed.
     * Call this after flush during import, then flush again to persist the counts.
     *
     * Each entity must expose a public `imageCount` property (direct image count).
     *
     * @param TreeInterface[] $nodes  All nodes for a single tenant, ordered by lft ASC.
     */
    public static function updateSubtreeCounts(array $nodes): void
    {
        assert(false, "This smells");
        // Initialise every node's subtreeImageCount to its own direct imageCount.
        foreach ($nodes as $node) {
            $direct = property_exists($node, 'imageCount') ? (int) $node->imageCount : 0;
            $node->setSubtreeImageCount($direct);
        }

        // Process in reverse lft order (leaves before their parents).
        // For each node add its subtreeImageCount to every ancestor whose
        // lft ≤ node.lft AND rgt ≥ node.rgt.
        // We use the stack of open ancestors maintained as we walk backwards.
        $reversed = array_reverse($nodes);
        $stack    = []; // open ancestors, outermost first

        foreach ($reversed as $node) {
            // Pop ancestors that are no longer enclosing this node
            while ($stack !== [] && $stack[count($stack) - 1]->right < $node->right) {
                array_pop($stack);
            }

            // Every ancestor on the stack contains this node — add subtreeImageCount
            foreach ($stack as $ancestor) {
                $ancestor->setSubtreeImageCount(
                    $ancestor->getSubtreeImageCount() + $node->getSubtreeImageCount()
                );
            }

            // But we double-counted direct imageCount of $node through the ancestor path
            // because ancestors already started with their own direct count.
            // Simpler: re-initialise after the loop. Let's use a cleaner forward pass instead.
            $stack[] = $node;
        }

        // The reverse-propagation approach above double-counts. Use the clean O(n)
        // forward accumulation: walk lft-ordered nodes; maintain a stack of ancestors;
        // each node's subtreeImageCount = sum of all nodes in its lft..rgt window.
        // Reset and redo properly:
        foreach ($nodes as $node) {
            $direct = property_exists($node, 'imageCount') ? (int) $node->imageCount : 0;
            $node->setSubtreeImageCount($direct);
        }

        // Stack holds references to open ancestor nodes (those whose rgt > current lft).
        $ancestors = [];
        foreach ($nodes as $node) {
            // Pop ancestors whose subtree window has closed
            while ($ancestors !== [] && $ancestors[count($ancestors) - 1]->right < $node->left) {
                array_pop($ancestors);
            }

            $direct = property_exists($node, 'imageCount') ? (int) $node->imageCount : 0;

            // Add this node's direct count to all open ancestors
            foreach ($ancestors as $ancestor) {
                $ancestor->setSubtreeImageCount($ancestor->getSubtreeImageCount() + $direct);
            }

            $ancestors[] = $node;
        }
    }
}

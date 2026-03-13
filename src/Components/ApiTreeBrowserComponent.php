<?php

namespace Survos\Tree\Components;

use ApiPlatform\Metadata\IriConverterInterface;
use Symfony\UX\TwigComponent\Attribute\PreMount;
use Symfony\UX\TwigComponent\Attribute\AsTwigComponent;
use Twig\Environment;

#[AsTwigComponent('apiTreeBrowser', template: '@SurvosTree/components/api_tree_browser.html.twig')]
class ApiTreeBrowserComponent extends ApiTreeComponent
{
    public string $api = '';

    public string $resourceClass = '';

    public string $style = 'bootstrap';

    public string $browserClass = 'api-tree-browser';

    public string $treePaneClass = '';

    public string $contentPaneClass = '';

    public string $contentPlaceholder = 'Select a node to view details';

    public bool $selectFirst = true;

    #[PreMount]
    public function preMountBrowser(array $data): array
    {
        if (($data['apiUrl'] ?? '') === '' && ($data['api'] ?? '') !== '') {
            $data['apiUrl'] = $data['api'];
        }

        if (($data['apiUrl'] ?? '') !== '' && ($data['browserClass'] ?? '') === '' && ($data['class'] ?? '') !== '') {
            $data['browserClass'] = $data['class'];
            $data['class'] = '';
        }

        if (($data['class'] ?? '') === '' && ($data['resourceClass'] ?? '') !== '') {
            $data['class'] = $data['resourceClass'];
        }

        return parent::preMount($data);
    }

    public function __construct(
        ?string $stimulusController,
        Environment $twig,
        IriConverterInterface $iriConverter,
    ) {
        parent::__construct($stimulusController, $twig, $iriConverter);
    }

    public function getBrowserClasses(): string
    {
        $classes = [trim($this->browserClass) ?: 'api-tree-browser'];

        if ($this->style !== '') {
            $classes[] = 'api-tree-browser--' . trim($this->style);
        }

        return implode(' ', array_filter($classes));
    }

    public function getResolvedTreePaneClass(): string
    {
        return trim($this->treePaneClass) !== ''
            ? trim($this->treePaneClass)
            : 'api-tree-browser__tree';
    }

    public function getResolvedContentPaneClass(): string
    {
        return trim($this->contentPaneClass) !== ''
            ? trim($this->contentPaneClass)
            : 'api-tree-browser__content';
    }
}

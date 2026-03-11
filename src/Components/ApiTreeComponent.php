<?php

namespace Survos\Tree\Components;

use Survos\Tree\Model\Column;
use Symfony\UX\TwigComponent\Attribute\AsTwigComponent;
use Symfony\UX\TwigComponent\Attribute\PreMount;
use Twig\Environment;

#[AsTwigComponent('api_tree', template: '@SurvosTree/components/api_tree.html.twig')]
class ApiTreeComponent
{
    public function __construct(
        public ?string $stimulusController
    ) {
        $this->stimulusController ??= '@survos/tree-bundle/api_tree';
    }

    public iterable $data;

    public array $columns = [];

    public ?string $caller = null;

    public string $class;

    public string $apiUrl;

    public string $labelField;

    public array $filter = [];

    public bool $editable = true;

    /** Per-type icon/style config passed to the jstree types plugin. */
    public array $types = [];

    // @todo: add jstwig
//    private function getTwigBlocks(): iterable
//    {
//        $customColumnTemplates = [];
//        if ($this->caller) {
//            $template = $this->twig->resolveTemplate($this->caller);
//            // total hack, but not sure how to get the blocks any other way
//            $source = $template->getSourceContext()->getCode();
//            $source = preg_replace('/{#.*?#}/', '', $source);
//
//            // this blows up with nested blocks.
//            // first, get the component twig
//            if (preg_match('/component.*?%}(.*?) endcomponent/ms', $source, $mm)) {
//                $twigBlocks = $mm[1];
//            } else {
//                $twigBlocks = $source;
//            }
//            if (preg_match_all('/{% block (.*?) %}(.*?){% endblock/ms', $twigBlocks, $mm, PREG_SET_ORDER)) {
//                foreach ($mm as $m) {
//                    [$all, $columnName, $twigCode] = $m;
//                    $customColumnTemplates[$columnName] = trim($twigCode);
//                }
//            }
//        }
//        return $customColumnTemplates;
//    }

    public function getApiUrl(): string
    {
        return $this->apiUrl;
    }
}

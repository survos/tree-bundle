<?php

namespace Survos\Tree\Components;

use Survos\Tree\Model\Column;
use Symfony\Component\DomCrawler\Crawler;
use Symfony\UX\TwigComponent\Attribute\AsTwigComponent;
use Symfony\UX\TwigComponent\Attribute\PreMount;
use Twig\Environment;
use Twig\TemplateWrapper;

#[AsTwigComponent('api_tree', template: '@SurvosTree/components/api_tree.html.twig')]
class ApiTreeComponent
{
    public function __construct(
        public ?string $stimulusController,
        private readonly Environment $twig,
    ) {
        $this->stimulusController ??= '@survos/tree-bundle/api_tree';
    }

    public iterable $data;

    public array $columns = [];

    public string|TemplateWrapper|null $caller = null;

    public string $class;

    public string $apiUrl;

    public string $labelField = 'name';

    public array $filter = [];

    public bool $editable = true;

    /** Per-type icon/style config passed to the jstree types plugin. */
    public array $types = [];

    #[PreMount]
    public function preMount(array $data): array
    {
        if (($data['caller'] ?? null) instanceof TemplateWrapper) {
            $data['caller'] = $data['caller']->getTemplateName();
        }
        return $data;
    }

    public function getCallerName(): ?string
    {
        if ($this->caller instanceof TemplateWrapper) {
            return $this->caller->getTemplateName();
        }
        if (is_string($this->caller) && trim($this->caller) !== '') {
            return $this->caller;
        }
        return null;
    }

    /**
     * Extracts <twig:block name="..."> children from the api_tree component
     * invocation in the caller template. Returns an array keyed by block name.
     */
    public function getBlocks(): array
    {
        return $this->extractTwigComponentBlocks();
    }

    private function extractTwigComponentBlocks(): array
    {
        if (!$this->caller) {
            return [];
        }

        $callerName = $this->caller instanceof TemplateWrapper
            ? $this->caller->getTemplateName()
            : (string) $this->caller;

        $sourceContext = $this->twig->getLoader()->getSourceContext($callerName);
        $source = file_get_contents($sourceContext->getPath());

        // ── Step 1: protect Twig tokens from HTML parser ──────────────────────
        $placeholders = [];
        $counter      = 0;
        $protected    = preg_replace_callback(
            '/(\{\{.*?\}\}|\{%.*?%\}|\{#.*?#\})/s',
            static function (array $m) use (&$placeholders, &$counter): string {
                $token = $m[1];
                $key   = '__twig_' . $counter++ . '__';
                $placeholders[$key] = $token;
                return $key;
            },
            $source
        );

        // ── Step 2: strip twig: namespace prefix ──────────────────────────────
        $html = str_replace('twig:', '', $protected);

        // ── Step 3: isolate api_tree inner content ────────────────────────────
        // Match either {% component api_tree ... %}...{% endcomponent %} or
        // <api_tree ...>...</api_tree> syntax
        if (preg_match('/<api_tree\b[^>]*>(.*?)<\/api_tree>/s', $html, $m)) {
            $inner = $m[1];
        } elseif (preg_match('/component\s+api_tree\b.*?%}(.*?)endcomponent/s', $html, $m)) {
            $inner = $m[1];
        } else {
            $inner = $html;
        }

        // ── Step 4: parse with DomCrawler and extract <block> elements ────────
        $crawler = new Crawler();
        $crawler->addHtmlContent('<div>' . $inner . '</div>');

        $blocks = [];
        $crawler->filterXPath('//block[@name]')->each(function (Crawler $node) use (&$blocks, $placeholders) {
            $name    = $node->attr('name');
            $content = $node->html();

            $content = str_replace(['&lt;', '&gt;', '&amp;', '&quot;'], ['<', '>', '&', '"'], $content);
            $content = preg_replace('/(__twig_\d+__)=""/', '$1', $content);
            $content = strtr($content, $placeholders);

            $blocks[$name] = trim($content);
        });

        return $blocks;
    }

    public function getApiUrl(): string
    {
        return $this->apiUrl;
    }
}

<?php

namespace Survos\Tree\Components;

use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\IriConverterInterface;
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
        private readonly IriConverterInterface $iriConverter,
    ) {
        $this->stimulusController ??= '@survos/tree/api_tree';
    }

    public iterable $data;

    public array $columns = [];

    public string|TemplateWrapper|null $caller = null;

    public string $class = '';

    public string $apiUrl = '';

    public string $labelField = 'name';

    public array $filter = [];

    public array $globals = [];

    public ?string $selectedId = null;

    public ?string $itemApiPattern = null;

    public bool $editable = true;

    public bool $openAll = false;

    public bool $selectFirst = false;

    /** Per-type icon/style config passed to the jstree types plugin. */
    public array $types = [];

    #[PreMount]
    public function preMount(array $data): array
    {
        if (($data['caller'] ?? null) instanceof TemplateWrapper) {
            $data['caller'] = $data['caller']->getTemplateName();
        }

        $apiUrl = $data['apiUrl'] ?? '';
        $class  = $data['class']  ?? '';

        if (!$apiUrl && !$class) {
            throw new \InvalidArgumentException(
                'api_tree requires either "apiUrl" or "class" (an API Platform resource class).'
            );
        }

        if (!$apiUrl) {
            $data['apiUrl'] = $this->iriConverter->getIriFromResource($class, operation: new GetCollection());
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
        $blocks = $this->extractTwigComponentBlocks();
        error_log('[api_tree] extracted blocks for ' . ($this->getCallerName() ?? 'unknown') . ': ' . implode(', ', array_keys($blocks)));
        return $blocks;
    }

    protected function componentTagPatterns(): array
    {
        return ['api_tree', 'apiTreeBrowser', 'api_tree_browser'];
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

        // ── Step 3: isolate this component's inner content ────────────────────
        $inner = $html;
        foreach ($this->componentTagPatterns() as $tagName) {
            if (preg_match(sprintf('/<%s\b[^>]*>(.*?)<\/%s>/s', preg_quote($tagName, '/'), preg_quote($tagName, '/')), $html, $m)) {
                $inner = $m[1];
                break;
            }
            if (preg_match(sprintf('/component\s+%s\b.*?%%}(.*?)endcomponent/s', preg_quote($tagName, '/')), $html, $m)) {
                $inner = $m[1];
                break;
            }
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

<?php

namespace Survos\Tree\Tests\Components;

use ApiPlatform\Metadata\IriConverterInterface;
use PHPUnit\Framework\TestCase;
use Survos\Tree\Components\ApiTreeComponent;
use Twig\Environment;
use Twig\Loader\FilesystemLoader;

class ApiTreeComponentTest extends TestCase
{
    public function testExtractsBlocksFromApiTreeBrowserComponent(): void
    {
        $component = $this->createComponent('api_tree_browser_fixture.html.twig');

        $blocks = $component->getBlocks();

        self::assertArrayHasKey('nodeLabel', $blocks);
        self::assertArrayHasKey('api_tree_content', $blocks);
        self::assertStringContainsString("{{ (node.title ?? node.name ?? node.code ?? node.id)|default('Untitled') }}", $blocks['nodeLabel']);
        self::assertStringContainsString("{{ path('instance_browse', params) }}", $blocks['api_tree_content']);
    }

    public function testPreservesTwigTokensInExtractedBlockBodies(): void
    {
        $component = $this->createComponent('api_tree_browser_fixture.html.twig');

        $blocks = $component->getBlocks();

        self::assertStringContainsString('{% if node.imageCount is defined and node.imageCount %}', $blocks['nodeLabel']);
        self::assertStringContainsString('{{ globals.canWrite }}', $blocks['api_tree_content']);
        self::assertStringNotContainsString('&lt;', $blocks['api_tree_content']);
        self::assertStringNotContainsString('&gt;', $blocks['api_tree_content']);
    }

    public function testSupportsSnakeCaseApiTreeBrowserTagPattern(): void
    {
        $component = $this->createComponent('api_tree_browser_snake_case_fixture.html.twig');

        $blocks = $component->getBlocks();

        self::assertArrayHasKey('nodeLabel', $blocks);
        self::assertSame('{{ node.name }}', $blocks['nodeLabel']);
    }

    public function testReturnsEmptyBlocksWhenCallerIsMissing(): void
    {
        $loader = new FilesystemLoader(__DIR__ . '/../Fixtures/templates');
        $twig = new Environment($loader);
        $iriConverter = $this->createMock(IriConverterInterface::class);

        $component = new ApiTreeComponent('@survos/tree-bundle/api_tree', $twig, $iriConverter);
        $component->caller = null;

        self::assertSame([], $component->getBlocks());
    }

    private function createComponent(string $callerTemplate): ApiTreeComponent
    {
        $loader = new FilesystemLoader(__DIR__ . '/../Fixtures/templates');
        $twig = new Environment($loader);
        $iriConverter = $this->createMock(IriConverterInterface::class);

        $component = new ApiTreeComponent('@survos/tree-bundle/api_tree', $twig, $iriConverter);
        $component->caller = $callerTemplate;

        return $component;
    }
}

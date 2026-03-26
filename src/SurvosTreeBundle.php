<?php

namespace Survos\Tree;

use Survos\CoreBundle\Traits\HasAssetMapperTrait;
use Survos\Tree\Components\ApiTreeBrowserComponent;
use Survos\Tree\Components\ApiTreeComponent;
use Survos\Tree\Components\TreeComponent;
use Survos\Tree\Service\TreeSnapshotBuilder;
use Survos\Tree\Twig\TwigExtension;
use Symfony\Component\Config\Definition\Configurator\DefinitionConfigurator;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Definition;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Bundle\AbstractBundle;
use Twig\Environment;
use JordanLev\TwigTreeTag\Twig\Extension\TreeExtension;

class SurvosTreeBundle extends AbstractBundle
{
    use HasAssetMapperTrait;
    // $config is the bundle Configuration that you usually process in ExtensionInterface::load() but already merged and processed
    public function loadExtension(array $config, ContainerConfigurator $container, ContainerBuilder $builder): void
    {
        $treeStimulusController = $config['tree_stimulus_controller'];
        $apiTreeStimulusController = $config['api_tree_stimulus_controller'];
        if (is_string($config['stimulus_controller'] ?? null) && $config['stimulus_controller'] !== '') {
            $apiTreeStimulusController = $config['stimulus_controller'];
        }

        // enabled the {% tree %} tag
        $x = $builder
            ->setDefinition('jordanlev.tree_extension', new Definition(TreeExtension::class))
            ->addTag('twig.extension')
            ->setPublic(true)
        ;

        // add the  twig function?
        if (class_exists(Environment::class)) {
            $builder
                ->setDefinition('survos.tree_bundle', new Definition(TwigExtension::class))
                ->addTag('twig.extension')
                ->setPublic(false);
        }

        $builder->register(TreeComponent::class)
            ->setAutowired(true)
            ->setAutoconfigured(true)
            ->setArgument('$stimulusController', $treeStimulusController)
        ;

        $builder->register(TreeInterface::class)
            ->setAutowired(true)
            ->setAutoconfigured(true)
        ;

        $builder->register(ApiTreeComponent::class)
            ->setAutowired(true)
            ->setAutoconfigured(true)
            ->setArgument('$stimulusController', $apiTreeStimulusController)
        ;

        $builder->register(ApiTreeBrowserComponent::class)
            ->setAutowired(true)
            ->setAutoconfigured(true)
            ->setArgument('$stimulusController', $apiTreeStimulusController)
        ;

        $builder->register(TreeSnapshotBuilder::class)
            ->setAutowired(true)
            ->setAutoconfigured(true)
            ->setPublic(true)
        ;
    }

    public function configure(DefinitionConfigurator $definition): void
    {
        // since the configuration is short, we can add it here
        $definition->rootNode()
            ->children()
            ->scalarNode('tree_stimulus_controller')->defaultValue('@survos/tree-bundle/tree')->end()
            ->scalarNode('api_tree_stimulus_controller')->defaultValue('@survos/tree-bundle/api_tree')->end()
            ->scalarNode('stimulus_controller')
                ->defaultNull()
                ->setDeprecated('survos/tree-bundle', '4.2', 'The "%node%" option is deprecated, use "api_tree_stimulus_controller" and/or "tree_stimulus_controller" instead.')
                ->end()
            ->end();

        ;
    }


    public function prependExtension(ContainerConfigurator $container, ContainerBuilder $builder): void
    {
        if (!$this->isAssetMapperAvailable($builder)) {
            return;
        }

        $dir = realpath(__DIR__.'/../assets/');
        assert(file_exists($dir), $dir);

        $builder->prependExtensionConfig('framework', [
            'asset_mapper' => [
                'paths' => [
                    $dir => '@survos/tree',
                ],
            ],
        ]);
    }
}

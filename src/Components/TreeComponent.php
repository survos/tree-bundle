<?php

namespace Survos\Tree\Components;

use Doctrine\Bundle\DoctrineBundle\Registry;
use Survos\Tree\Model\Column;
use Symfony\Component\OptionsResolver\OptionsResolver;
use Symfony\UX\TwigComponent\Attribute\AsTwigComponent;
use Symfony\UX\TwigComponent\Attribute\PreMount;

#[AsTwigComponent('tree', template: '@SurvosTree/components/tree.html.twig')]
class TreeComponent
{
    public function __construct(?string $stimulusController = null)
    {
        $this->stimulusController = $stimulusController ?? '@survos/tree-bundle/tree';
    }

    public ?iterable $data = null;

    public array $columns;

    public array $filter;

    public ?string $stimulusController = null;

    #[PreMount]
    public function preMount(array $parameters = []): array
    {
        $resolver = new OptionsResolver();
        $resolver->setDefaults([
            'data' => null,
            'class' => null,
            'filter' => [],
            'caller' => null,
            'columns' => [],
        ]);
        $parameters = $resolver->resolve($parameters);
        if (is_null($parameters['data'])) {
            $class = $parameters['class'];
            //            assert($class, "Must pass class or data");

            // @todo: something clever to limit memory, use yield?
            //            $parameters['data'] =  $this->registry->getRepository($class)->findAll();
        }
        //        $resolver->setAllowedValues('type', ['success', 'danger']);
        //        $resolver->setRequired('message');
        //        $resolver->setAllowedTypes('message', 'string');
        return $parameters;
    }
}

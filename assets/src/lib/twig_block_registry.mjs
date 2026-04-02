export function blocksToTwigSource(blocks) {
    return Object.entries(blocks)
        .map(([name, payload]) => {
            const body = typeof payload === 'string' ? payload : (payload?.html ?? '');
            return `<twig:block name="${name}">${body}</twig:block>`;
        })
        .join('\n');
}

export function sourceFromScriptContent(rawContent) {
    const raw = rawContent ?? '';
    const trimmed = String(raw).trim();

    if (trimmed === '') {
        return '';
    }

    if (trimmed.startsWith('{')) {
        const blocks = JSON.parse(trimmed);
        return blocksToTwigSource(blocks);
    }

    return raw;
}

// Whether another module runs fights (WAVE rule 11: Story Director alone asks for no encounters). One rule for
// every place that asks, from Story Block's `sdk.modules()` entries: a module other than `selfId` that registers
// `combat.*` commands. On a host with a module lifecycle (the entries carry `status`) it must also be `ready`:
// a dormant module (its peer is missing or off), or any module while a restore is pending, runs no fights.
// Older hosts have no status; there the command probe stays as it was.

/** `modules`: sdk.modules(); → boolean. */
export function fightsAmong(modules, selfId) {
    const lifecycle = modules.some(entry => typeof entry?.status === 'string');
    return modules.some(entry => entry?.id !== selfId && (!lifecycle || entry.status === 'ready') && (entry?.commands ?? []).some(type => String(type).startsWith('combat.')));
}

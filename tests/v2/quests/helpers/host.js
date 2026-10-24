// A real SB+SD+RB host. D1 and the frozen rule projections are explicit integration fixtures.
import { createHost } from '../../../vendor/story-block/testkit/host.js';
import { createModule } from '../../../../src/v2/module.js';
import { createModule as director } from '../../../../../Story_director/src/v2/module.js';
import { createQuestPart } from '../../../../src/v2/quests/index.js';
import { buildGuard } from './b5.js';
import { withD1 } from './d1.js';

export const template = (more = {}) => ({ id: 'pack.fixture/job', name: 'Mill job', category: 'side', giver: null, turnInPlace: null,
    requirements: [], objectives: [{ id: 'ob_00000001', kind: 'collect', def: 'pack.fixture/herb', count: 2, consume: true }],
    reward: { coin: 30, xp: 25, items: [] }, durationMinutes: null, repeat: null, chain: null, ...more });
export const herb = { id: 'pack.fixture/herb', name: 'Herb', kind: 'goods', rarity: 'common', value: 1, stack: true,
    slot: null, stats: {}, effect: {}, tags: [], note: '' };
export async function questHost({ policy = {}, templates = [template()], legacy = [], extra = [], st = null } = {}) {
    const testRules = { initial: () => ({ rulesVersion: 2, rulesHash: 'a'.repeat(64), pin: { resolved: { quests: Object.fromEntries(templates.map(t => [t.id, t])) } } }), validate: () => [] };
    const def = createModule({});
    // Replace only the quest part, preserving production wrappers and real party/item/combat commands.
    // createModule uses fixed PARTS; each factory result installs the same public handlers under test.
    const qp = createQuestPart({ buildGuard, ...policy });
    Object.assign(def.commands, Object.fromEntries(Object.entries(qp.commands).map(([type, fn]) => [type, fn])));
    Object.assign(def.queries, qp.queries);
    if (qp.hooks) def.hooks = { ...def.hooks, ...qp.hooks };
    const originalCapture = def.capture.apply;
    def.capture.apply = (ctx, line) => line.kind === 'quest' ? qp.kinds.quest.apply(ctx, line) : originalCapture(ctx, line);
    def.domains.rules = testRules;
    def.queries['rules.party'] = (_state, _args, tools) => {
        const actors = tools.query('party.actors', {});
        const pc = tools.query('party.pc', {});
        return { pc: pc?.id ?? null, active: actors.filter(a => ['pc', 'companion'].includes(a.kind)).map(a => ({ ...a, life: 'alive' })), reserve: [], temporary: [], activeLimit: 3 };
    };
    def.queries['rules.sheet'] = (_state, { actor } = {}, tools) => actor ? tools.query('party.actor', { id: actor }) : tools.query('party.pc', {});
    const sd = director();
    if (legacy.length) {
        const initial = sd.domains.director.initial;
        sd.domains.director = { ...sd.domains.director, initial: () => ({ ...initial(), threads: Object.fromEntries(legacy.map(t => [t.id, t])), keys: Object.fromEntries(legacy.flatMap(t => [t.key, ...(t.aliases ?? [])].map(key => [key.toLowerCase(), t.id]))) }) };
    }
    const h = await createHost({ modules: [withD1(sd), withD1(def), ...extra], ...(st ? { st } : {}) });
    if (st) return h;
    await h.send('At the mill.', '<Changes>\n~ time June 3, 1200, 08:00 am\n</Changes>');
    const made = await h.sdk.command('party.create', { name: 'Ren', preset: 'fighter' });
    if (!made.ok) throw new Error(made.message);
    return h;
}
export const offer = async (h, name = 'Mill job') => {
    await h.send('What work is offered?', `<Changes>\n+ quest ${name}\n</Changes>`);
    return h.sdk.query('director.thread', { key: name });
};

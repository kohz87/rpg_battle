// A pack's creation content as Story Block's packs.content gives it (full ids, PACKS.md; the
// Ersveil pack's "Wessel (kit)" preset, made smaller): races, talents, skills and presets.
export const PACKS = Object.freeze({
    races: [
        { id: 'pack.ersveil/human', slug: 'human', pack: 'ersveil', name: 'Human', note: 'No stat change.', stats: {}, tags: ['human'] },
        { id: 'pack.ersveil/elf', slug: 'elf', pack: 'ersveil', name: 'Elf', note: 'Long-lived.', stats: { DEX: 1, VIT: -1 }, tags: ['elf'] },
    ],
    talents: [
        { id: 'pack.ersveil/shadow-bent', slug: 'shadow-bent', pack: 'ersveil', name: 'Shadow-bent', note: 'Self-taught shadow.', stats: { INT: 1 }, tags: ['shadow'] },
        { id: 'pack.ersveil/river-born', slug: 'river-born', pack: 'ersveil', name: 'River-born', note: 'At home on a barge.', stats: { AGI: 1 }, tags: ['river'] },
    ],
    skills: [
        { id: 'pack.ersveil/cane-draw', slug: 'cane-draw', pack: 'ersveil', name: 'Cane Draw', type: 'physical', stat: 'DEX', target: 'one', element: null, note: 'The hidden blade drawn and cut in one motion.', tags: ['blade'] },
        { id: 'pack.ersveil/shadow-cut', slug: 'shadow-cut', pack: 'ersveil', name: 'Shadow Cut', type: 'magic', stat: 'INT', target: 'all', element: null, note: 'A thin arc of cold shadow.', tags: ['shadow'] },
    ],
    presets: [
        {
            id: 'pack.ersveil/wessel-kit', slug: 'wessel-kit', pack: 'ersveil', name: 'Wessel (kit)', note: 'Name and background come from the persona.',
            race: 'pack.ersveil/human', talents: ['pack.ersveil/shadow-bent', 'pack.ersveil/river-born'],
            points: { STR: 0, VIT: 1, AGI: 2, DEX: 3, INT: 1, LUK: 1, CHA: 0 },
            skills: ['pack.ersveil/cane-draw', 'pack.ersveil/shadow-cut'],
        },
    ],
});

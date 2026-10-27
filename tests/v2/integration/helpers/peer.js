// Unit/integration fixtures that exercise ready RB without SD mechanics still need its registered peer.
// No queries or clock are supplied: tests that need those register their own explicit fixture.
export const DIRECTOR_PEER = { id: 'story-director', name: 'Story Director test peer', version: '2.0.0-beta.2' };

// Fixed story minute for fixtures that exercise rests without advancing time. It settles nothing (`time.overdue` says every reply began long ago), so a rest has its hours: it heals what the
// party's own mark of recovery leaves, which is everything when nothing has been taken yet.
export const DIRECTOR_CLOCK = { ...DIRECTOR_PEER, queries: { 'director.time': () => ({ minutes: 0 }), 'time.overdue': () => ({ minutes: -1000000 }) } };

export const withDirector = modules => modules.some(module => module.id === DIRECTOR_PEER.id)
    ? modules : [DIRECTOR_PEER, ...modules];

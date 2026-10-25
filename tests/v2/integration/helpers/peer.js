// Unit/integration fixtures that exercise ready RB without SD mechanics still need its registered peer.
// No queries or clock are supplied: tests that need those register their own explicit fixture.
export const DIRECTOR_PEER = { id: 'story-director', name: 'Story Director test peer', version: '2.0.0-beta.2' };

export const withDirector = modules => modules.some(module => module.id === DIRECTOR_PEER.id)
    ? modules : [DIRECTOR_PEER, ...modules];

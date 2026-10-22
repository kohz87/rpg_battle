// Test helper. A story clock in Story Director's shape: `director.time.minutes`, a counter (SD #98), moved by a
// change line: `! time +2h` / `! time +30m` moves it, `~ time 600` sets it (a set back too).
export const CLOCK = {
    id: 'fake-director',
    name: 'Fake Story Director clock',
    version: '0.0.0',
    domains: { director: { initial: () => ({ time: { minutes: null } }), validate: () => [], counters: ['time/minutes'] } },
    queries: { 'director.time': state => ({ minutes: state?.domains?.director?.time?.minutes ?? null }) },
    capture: {
        kinds: { time: { grammar: '! time +<n>h|m · ~ time <minute>' } },
        apply(ctx, line) {
            const time = ctx.draft('director').time;
            const word = String(line.name ?? '').trim();
            const move = /^\+(\d+)\s*(h|m)$/i.exec(word);
            if (move) time.minutes = (time.minutes ?? 0) + Number(move[1]) * (move[2].toLowerCase() === 'h' ? 60 : 1);
            else time.minutes = Number(word);
            return { summary: `Story time: ${time.minutes}.`, narrate: false };
        },
    },
};


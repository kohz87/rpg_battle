// RPG Battle's panel under Extensions: the on/off switch, the money, the terms, the party, and the block tags.
//
// Small on purpose: everything about a character happens in the Battle tab. Money follows the
// reader's world (DESIGN §8.3): copper/silver/gold, one coin, or their own names and rates.
// So do the terms (DESIGN §5.7): what levels and XP are called, optional tier titles
// ("Soul Class I" for levels 1–10…) and the level cap; nothing here knows any world's words.
// The status area also says when Story Block's own Character Sheet block is on beside RPG
// Battle's sheet, with a button to turn it off; it is never turned off for the reader.
// Generated words (DESIGN §7.4): whether a made-up creature, and a companion's starting skills
// (0.4), get the story's words from a model call, on the chat's model or a connection profile
// (picked like Story Director's), and how long that answer may be.
// Source of truth (Story Suite, docs/STORY_SUITE.md): for each area RPG Battle shares with the
// other extensions, Automatic, This extension or The other one, with who the story follows now.
// With two or more of them installed, a "Manage all in Story Suite" link at the top opens Story
// Block's overlay on RPG Battle's tab (the glue says when it shows and what it opens).

const CURRENCY_MODES = [
    { value: 'tiers', label: 'Copper / silver / gold, or your own coins' },
    { value: 'single', label: 'One coin' },
];

function el(tag, { className, text, attrs } = {}, children = []) {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value);
    for (const child of children) if (child) node.append(child);
    return node;
}

function input(id, value, placeholder = '') {
    const node = el('input', { className: 'text_pole rpg-battle-settings-input', attrs: { id, type: 'text' } });
    node.value = value ?? '';
    if (placeholder) node.placeholder = placeholder;
    return node;
}

function row(label, hint, control, id) {
    return el('div', { className: 'rpg-battle-settings-row' }, [
        el('label', { className: 'rpg-battle-settings-label', text: label, attrs: id ? { for: id } : {} }),
        hint ? el('small', { className: 'rpg-battle-settings-hint', text: hint }) : null,
        control,
    ]);
}

/** "copper=1, silver=10, gold=10" ⇄ [{ name, rate }]. */
export function tiersToText(tiers) {
    return (tiers ?? []).map(tier => `${tier.name}=${tier.rate}`).join(', ');
}

export function textToTiers(text) {
    const tiers = String(text ?? '').split(/[,;\n]/).map(part => {
        const match = /^\s*([^=]+?)\s*=\s*(\d+(?:\.\d+)?)\s*$/.exec(part) ?? /^\s*(\S.*?)\s*$/.exec(part);
        if (!match) return null;
        const rate = match[2] === undefined ? 1 : Math.max(1, Math.round(Number(match[2])));
        return { name: match[1].trim(), rate };
    }).filter(tier => tier && tier.name);
    if (tiers.length) tiers[0] = { ...tiers[0], rate: 1 };
    return tiers;
}

const NUMERAL_CHOICES = [
    { value: 'roman', label: 'I, II, III' },
    { value: 'arabic', label: '1, 2, 3' },
];

function numberInput(id, value, { min = 1, max = 999, placeholder = '' } = {}) {
    const node = el('input', { className: 'text_pole rpg-battle-settings-input rpg-battle-settings-number', attrs: { id, type: 'number', min: String(min), max: String(max), step: '1' } });
    node.value = value === null || value === undefined ? '' : String(value);
    if (placeholder) node.placeholder = placeholder;
    return node;
}

const wholeOrNull = (text, min, max) => {
    const value = Math.round(Number(String(text ?? '').trim()));
    return String(text ?? '').trim() && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
};

const CONFLICT_TEXT = 'Story Block\'s Character Sheet is also on: two HP values will disagree.';

// The flavour call's answer length: enough for six short lines, never a story.
const FLAVOUR_TOKENS = { min: 100, max: 2000 };

const TRUTH_OPTIONS = [
    { value: 'auto', label: 'Automatic' },
    { value: 'mine', label: 'This extension' },
    { value: 'theirs', label: 'The other one' },
];

// What each choice changes here; the rest is up to the other extension's own setting.
const TRUTH_AREAS = [
    { area: 'stats', label: 'Stats', hint: 'HP, MP, stats, skills. With RPG Battle the source, Story Block\'s Character Sheet is pointed out as a second HP; The other one keeps both without the notice (fights still use RPG Battle\'s sheets).' },
    { area: 'rolls', label: 'Roll modifiers', hint: 'Checks outside fights: the Character block\'s Checks line is the modifier Story Block\'s Dice block can use.' },
    { area: 'items', label: 'Items', hint: 'What you carry: RPG Battle reads gear from Story Block\'s Inventory block and writes loot into it.' },
];

const sourceText = source => (source?.name ? `Now: ${source.name}` : '');

// The panel's sections fold, each one line with a summary until opened. Which are open is the
// reader's own convenience, remembered in this browser only; all start closed.
const FOLDS_STORAGE = 'rpg_battle_settings_folds';

function foldsOpen() {
    try {
        const saved = JSON.parse(globalThis.localStorage?.getItem(FOLDS_STORAGE) ?? 'null');
        return saved && typeof saved === 'object' ? saved : {};
    } catch {
        return {};
    }
}

function rememberFold(key, open) {
    try { globalThis.localStorage?.setItem(FOLDS_STORAGE, JSON.stringify({ ...foldsOpen(), [key]: open })); } catch { /* private window */ }
}

/** One line per section, from the settings as they are now. */
export function foldHints(settings) {
    const current = settings ?? {};
    const currency = current.currency ?? {};
    const terms = current.terms ?? {};
    const gear = { worn: 1, accessories: 2, ...(current.gear ?? {}) };
    const chosen = Object.values(current.sourceOfTruth ?? {}).filter(choice => choice && choice !== 'auto').length;
    return {
        money: currency.mode === 'single' ? String(currency.single || 'coins') : (currency.tiers ?? []).map(tier => tier.name).join(' / ') || 'coins',
        equipment: `${gear.worn} worn · ${gear.accessories} ${Number(gear.accessories) === 1 ? 'accessory' : 'accessories'}`,
        terms: [terms.levelName || 'Level', terms.xpName || 'XP', terms.tiers ? 'tiers' : '', terms.cap ? `cap ${terms.cap}` : ''].filter(Boolean).join(' · '),
        monsters: current.flavour?.enabled === false ? 'Model calls off' : 'Model calls on',
        party: `${Number(current.activeSkills) || 6} active skills · ${current.autoSpend === false ? 'points by hand' : 'auto-spend'}`,
        truth: chosen ? `${chosen} chosen by hand` : 'Automatic',
        blocks: [current.partyTag || 'Party', current.inventoryTag || 'Inventory'].join(' · '),
    };
}

export function renderSettings(container, { settings, version = '', status = '', sheetConflict = false, sources = null, profiles = null, suiteLink = false, onOpenSuite, onDisableSheet, onChange } = {}) {
    let current = structuredClone(settings ?? {});
    const hintNodes = {};
    const refreshHints = () => {
        const hints = foldHints(current);
        for (const [key, node] of Object.entries(hintNodes)) if (node.textContent !== hints[key]) node.textContent = hints[key];
    };
    const commit = change => {
        change(current);
        refreshHints();
        onChange?.(structuredClone(current));
    };
    const open = foldsOpen();
    const fold = (key, title, children) => {
        hintNodes[key] = el('small', { className: 'rpg-battle-settings-fold-hint' });
        const node = el('details', { className: `rpg-battle-settings-fold is-${key}` }, [
            el('summary', { className: 'rpg-battle-settings-fold-head' }, [el('span', { className: 'rpg-battle-settings-fold-title', text: title }), hintNodes[key]]),
            ...children,
        ]);
        node.dataset.fold = key;
        node.open = open[key] === true;
        node.addEventListener('toggle', () => rememberFold(key, Boolean(node.open)));
        return node;
    };

    const enabled = el('input', { attrs: { id: 'rpg_battle_enabled', type: 'checkbox' } });
    enabled.checked = current.enabled !== false;
    enabled.addEventListener('change', () => commit(next => { next.enabled = enabled.checked; }));

    const mode = el('select', { className: 'text_pole rpg-battle-settings-input', attrs: { id: 'rpg_battle_currency_mode' } },
        CURRENCY_MODES.map(option => {
            const node = el('option', { text: option.label });
            node.value = option.value;
            return node;
        }));
    mode.value = current.currency?.mode === 'single' ? 'single' : 'tiers';
    const tiers = input('rpg_battle_currency_tiers', tiersToText(current.currency?.tiers), 'copper=1, silver=10, gold=10');
    const single = input('rpg_battle_currency_single', current.currency?.single, 'coins');
    const moneyRow = input('rpg_battle_currency_row', current.currency?.row, 'Coins');
    const tiersRow = row('Coins', 'Smallest first; each rate is how many of the one before make one of this.', tiers, 'rpg_battle_currency_tiers');
    const singleRow = row('Coin name', '', single, 'rpg_battle_currency_single');
    const sync = () => {
        tiersRow.hidden = mode.value !== 'tiers';
        singleRow.hidden = mode.value !== 'single';
    };
    mode.addEventListener('change', () => {
        sync();
        commit(next => { next.currency = { ...next.currency, mode: mode.value }; });
    });
    tiers.addEventListener('change', () => {
        const parsed = textToTiers(tiers.value);
        if (!parsed.length) return;
        tiers.value = tiersToText(parsed);
        commit(next => { next.currency = { ...next.currency, tiers: parsed }; });
    });
    single.addEventListener('change', () => commit(next => { next.currency = { ...next.currency, single: single.value.trim() || 'coins' }; }));
    moneyRow.addEventListener('change', () => commit(next => { next.currency = { ...next.currency, row: moneyRow.value.trim() || 'Coins' }; }));

    // Terms: kept as the reader typed them (empty means the default), tiers as an object or null.
    const terms = { levelName: 'Level', xpName: 'XP', tiers: null, cap: null, ...(current.terms ?? {}) };
    const levelName = input('rpg_battle_terms_level', terms.levelName === 'Level' ? '' : terms.levelName, 'Level');
    const xpName = input('rpg_battle_terms_xp', terms.xpName === 'XP' ? '' : terms.xpName, 'XP');
    const tiersOn = el('input', { attrs: { id: 'rpg_battle_terms_tiers', type: 'checkbox' } });
    tiersOn.checked = Boolean(terms.tiers);
    const tierSize = numberInput('rpg_battle_terms_tier_size', terms.tiers?.size ?? 10, { min: 1, max: 100 });
    const numerals = el('select', { className: 'text_pole rpg-battle-settings-input', attrs: { id: 'rpg_battle_terms_numerals' } },
        NUMERAL_CHOICES.map(choice => {
            const node = el('option', { text: choice.label });
            node.value = choice.value;
            return node;
        }));
    numerals.value = terms.tiers?.numerals === 'arabic' ? 'arabic' : 'roman';
    const cap = numberInput('rpg_battle_terms_cap', terms.cap, { min: 1, max: 999, placeholder: '99' });
    const tierRows = el('div', { className: 'rpg-battle-settings-tiers' }, [
        row('Levels per tier', 'Levels 1 to this are tier I, the next as many tier II…', tierSize, 'rpg_battle_terms_tier_size'),
        row('Numerals', '', numerals, 'rpg_battle_terms_numerals'),
    ]);
    const tiersValue = () => (tiersOn.checked
        ? { size: wholeOrNull(tierSize.value, 1, 100) ?? 10, numerals: numerals.value === 'arabic' ? 'arabic' : 'roman' }
        : null);
    const syncTerms = () => {
        tierRows.hidden = !tiersOn.checked;
        tierSize.disabled = !tiersOn.checked;
        numerals.disabled = !tiersOn.checked;
    };
    const commitTerms = change => commit(next => { next.terms = { ...terms, ...(next.terms ?? {}), ...change }; });
    levelName.addEventListener('change', () => commitTerms({ levelName: levelName.value.trim() || 'Level' }));
    xpName.addEventListener('change', () => commitTerms({ xpName: xpName.value.trim() || 'XP' }));
    tiersOn.addEventListener('change', () => {
        syncTerms();
        commitTerms({ tiers: tiersValue() });
    });
    tierSize.addEventListener('change', () => {
        tierSize.value = String(wholeOrNull(tierSize.value, 1, 100) ?? 10);
        commitTerms({ tiers: tiersValue() });
    });
    numerals.addEventListener('change', () => commitTerms({ tiers: tiersValue() }));
    cap.addEventListener('change', () => {
        const value = wholeOrNull(cap.value, 1, 999);
        cap.value = value === null ? '' : String(value);
        commitTerms({ cap: value });
    });

    // Equipment: how many worn pieces and accessories count (rules.gear); 0 to 9 each.
    const gearSetting = { worn: 1, accessories: 2, ...(current.gear ?? {}) };
    const gearInput = (id, key, fallback) => {
        const node = numberInput(id, gearSetting[key], { min: 0, max: 9 });
        node.addEventListener('change', () => {
            const value = wholeOrNull(node.value, 0, 9) ?? fallback;
            node.value = String(value);
            commit(next => { next.gear = { ...gearSetting, ...(next.gear ?? {}), [key]: value }; });
        });
        return node;
    };
    const wornCount = gearInput('rpg_battle_gear_worn', 'worn', 1);
    const accessoryCount = gearInput('rpg_battle_gear_accessories', 'accessories', 2);

    // Party (0.4): how many skills a member fights with, and whether companions on auto spend
    // the points a level gives them.
    const activeSkills = numberInput('rpg_battle_active_skills', current.activeSkills ?? 6, { min: 3, max: 12 });
    activeSkills.addEventListener('change', () => {
        const value = wholeOrNull(activeSkills.value, 3, 12) ?? 6;
        activeSkills.value = String(value);
        commit(next => { next.activeSkills = value; });
    });
    const autoSpend = el('input', { attrs: { id: 'rpg_battle_auto_spend', type: 'checkbox' } });
    autoSpend.checked = current.autoSpend !== false;
    autoSpend.addEventListener('change', () => commit(next => { next.autoSpend = autoSpend.checked; }));

    const recover = el('input', { attrs: { id: 'rpg_battle_recover', type: 'checkbox' } });
    recover.checked = current.recoverWithTime !== false;
    recover.addEventListener('change', () => commit(next => { next.recoverWithTime = recover.checked; }));

    // Monsters: the flavour call. Connection profiles carry their own API and model; null
    // means Connection Manager is off, so only the chat's own model is offered.
    const flavourSetting = { enabled: true, model: { source: 'chat' }, maxTokens: 400, ...(current.flavour ?? {}) };
    const flavourOn = el('input', { attrs: { id: 'rpg_battle_flavour', type: 'checkbox' } });
    flavourOn.checked = flavourSetting.enabled !== false;
    const profileChoices = [{ value: '', label: 'Same as chat' }, ...(profiles ?? []).map(profile => ({ value: String(profile.id), label: String(profile.name ?? profile.id) }))];
    const chosen = flavourSetting.model?.source === 'profile' ? String(flavourSetting.model.profileId ?? '') : '';
    if (chosen && !profileChoices.some(choice => choice.value === chosen)) profileChoices.push({ value: chosen, label: '(missing profile)' });
    const flavourModel = el('select', { className: 'text_pole rpg-battle-settings-input', attrs: { id: 'rpg_battle_flavour_model' } },
        profileChoices.map(choice => {
            const node = el('option', { text: choice.label });
            node.value = choice.value;
            return node;
        }));
    flavourModel.value = chosen;
    const flavourTokens = numberInput('rpg_battle_flavour_tokens', flavourSetting.maxTokens, FLAVOUR_TOKENS);
    const commitFlavour = change => commit(next => { next.flavour = { ...flavourSetting, ...(next.flavour ?? {}), ...change }; });
    const syncFlavour = () => {
        flavourModel.disabled = !flavourOn.checked;
        flavourTokens.disabled = !flavourOn.checked;
    };
    flavourOn.addEventListener('change', () => {
        syncFlavour();
        commitFlavour({ enabled: flavourOn.checked });
    });
    flavourModel.addEventListener('change', () => commitFlavour({ model: flavourModel.value ? { source: 'profile', profileId: flavourModel.value } : { source: 'chat' } }));
    flavourTokens.addEventListener('change', () => {
        const value = wholeOrNull(flavourTokens.value, FLAVOUR_TOKENS.min, FLAVOUR_TOKENS.max) ?? 400;
        flavourTokens.value = String(value);
        commitFlavour({ maxTokens: value });
    });

    // Source of truth: one select per shared area, and who the story follows now (from the glue).
    const truth = { stats: 'auto', rolls: 'auto', items: 'auto', ...(current.sourceOfTruth ?? {}) };
    const nowLabels = {};
    const truthSelects = {};
    const truthRows = TRUTH_AREAS.map(({ area, label, hint }) => {
        const id = `rpg_battle_truth_${area}`;
        const select = el('select', { className: 'text_pole rpg-battle-settings-input', attrs: { id } },
            TRUTH_OPTIONS.map(option => {
                const node = el('option', { text: option.label });
                node.value = option.value;
                return node;
            }));
        select.value = TRUTH_OPTIONS.some(option => option.value === truth[area]) ? truth[area] : 'auto';
        truthSelects[area] = select;
        select.addEventListener('change', () => commit(next => { next.sourceOfTruth = { ...truth, ...(next.sourceOfTruth ?? {}), [area]: select.value }; }));
        nowLabels[area] = el('small', { className: 'rpg-battle-settings-hint rpg-battle-settings-source', text: sourceText(sources?.[area]) });
        const line = row(label, hint, select, id);
        line.append(nowLabels[area]);
        return line;
    });
    const setSources = next => {
        for (const { area } of TRUTH_AREAS) nowLabels[area].textContent = sourceText(next?.[area]);
    };

    const tag = (id, key, label, hint) => {
        const node = input(id, current[key]);
        node.addEventListener('change', () => commit(next => { next[key] = node.value.trim() || next[key]; }));
        return row(label, hint, node, id);
    };
    const returnMessage = input('rpg_battle_return', current.returnMessage);
    returnMessage.addEventListener('change', () => commit(next => { next.returnMessage = returnMessage.value; }));

    const turnOff = el('button', { className: 'menu_button rpg-battle-settings-sheet-off', text: 'Turn it off', attrs: { type: 'button' } });
    turnOff.addEventListener('click', () => onDisableSheet?.());
    const conflict = el('div', { className: 'rpg-battle-settings-status rpg-battle-settings-conflict' }, [
        el('span', { text: CONFLICT_TEXT }),
        turnOff,
    ]);
    conflict.hidden = !sheetConflict;

    const openSuite = el('button', { className: 'menu_button rpg-battle-settings-suite-open', attrs: { type: 'button' } }, [
        el('i', { className: 'fa-solid fa-gear' }),
        el('span', { text: 'Manage all in Story Suite' }),
    ]);
    openSuite.addEventListener('click', () => onOpenSuite?.());
    // data-story-suite-link: Story Block's overlay hides the line while the panel sits inside it.
    const suite = el('div', { className: 'rpg-battle-settings-suite', attrs: { 'data-story-suite-link': '' } }, [openSuite]);
    suite.hidden = !suiteLink;

    const root = el('div', { className: 'rpg-battle-settings' }, [
        el('div', { className: 'inline-drawer' }, [
            el('div', { className: 'inline-drawer-toggle inline-drawer-header' }, [
                el('b', {}, [globalThis.document.createTextNode('RPG Battle'), version ? el('span', { className: 'rpg-battle-version', text: ` ${version}` }) : null]),
                el('div', { className: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' }),
            ]),
            el('div', { className: 'inline-drawer-content' }, [
                suite,
                status ? el('div', { className: 'rpg-battle-settings-status', text: status }) : null,
                conflict,
                el('label', { className: 'checkbox_label', attrs: { for: 'rpg_battle_enabled' } }, [enabled, el('span', { text: 'Battles on (the Battle tab in Story Block)' })]),
                el('label', { className: 'checkbox_label', attrs: { for: 'rpg_battle_recover' } }, [recover, el('span', { text: 'Recover HP and MP as story time passes (needs Story Director)' })]),
                fold('money', 'Money', [
                    row('Currency', 'Loot is written in it.', mode, 'rpg_battle_currency_mode'),
                    tiersRow,
                    singleRow,
                    row('Inventory row', 'The Inventory row that holds your money.', moneyRow, 'rpg_battle_currency_row'),
                ]),
                fold('equipment', 'Equipment', [
                    el('small', { className: 'rpg-battle-settings-hint', text: 'A fight uses one weapon, one off-hand (none with a two-handed weapon) and one armour, plus these. Anything else marked equipped is listed under Gear in the Battle tab as not counted.' }),
                    row('Worn pieces', 'Helm, gloves, boots, belt…', wornCount, 'rpg_battle_gear_worn'),
                    row('Accessories', 'Rings, amulets, charms…', accessoryCount, 'rpg_battle_gear_accessories'),
                ]),
                fold('terms', 'Terms', [
                    el('small', { className: 'rpg-battle-settings-hint', text: 'What your world calls levels and XP. The sheets, the Battle tab and the fight summaries use these words; the numbers stay the same.' }),
                    row('Level name', 'For example Rank, Circle or Soul Class. Empty: Level.', levelName, 'rpg_battle_terms_level'),
                    row('XP name', 'For example Experience or Soul Growth. Empty: XP.', xpName, 'rpg_battle_terms_xp'),
                    el('label', { className: 'checkbox_label', attrs: { for: 'rpg_battle_terms_tiers' } }, [tiersOn, el('span', { text: 'Tier titles (Level I for levels 1–10, Level II for 11–20…)' })]),
                    tierRows,
                    row('Level cap', 'The highest level. Empty: 99.', cap, 'rpg_battle_terms_cap'),
                ]),
                fold('monsters', 'Generated words', [
                    el('small', { className: 'rpg-battle-settings-hint', text: 'A foe the bestiary does not know is made up from its name when its fight starts, and kept for this story; a companion who joins starts with skills that fit who they are. One short model call each gives the words (a creature\'s look, traits, skill and loot names; a companion\'s skills); code still sets every number. Off, or when a call fails: templates and library skills.' }),
                    el('label', { className: 'checkbox_label', attrs: { for: 'rpg_battle_flavour' } }, [flavourOn, el('span', { text: 'Generate words with a model call (new creatures before their fight, a new companion\'s skills)' })]),
                    row('Model', profiles === null ? 'Connection Manager is off, so the chat\'s own connection is used.' : 'A connection profile has its own API and model; a small, fast one is enough.', flavourModel, 'rpg_battle_flavour_model'),
                    row('Answer length', 'Most tokens one answer may use.', flavourTokens, 'rpg_battle_flavour_tokens'),
                ]),
                fold('party', 'Party', [
                    row('Active skills', 'Skills each member fights with (3 to 12). More are kept, set aside, and swapped in on their card.', activeSkills, 'rpg_battle_active_skills'),
                    el('label', { className: 'checkbox_label', attrs: { for: 'rpg_battle_auto_spend' } }, [autoSpend, el('span', { text: 'Spend companions\' points automatically (companions on auto, in their build\'s proportions)' })]),
                ]),
                fold('truth', 'Source of truth', [
                    el('small', { className: 'rpg-battle-settings-hint', text: 'With Story Block, Story Director or NPC State Delta beside RPG Battle, who the story follows for each area they share. Automatic: the specialist for it. Alone, every choice works like Automatic.' }),
                    ...truthRows,
                ]),
                fold('blocks', 'Blocks', [
                    tag('rpg_battle_party_tag', 'partyTag', 'Party tag', 'The kept block with your character and companions.'),
                    tag('rpg_battle_inventory_tag', 'inventoryTag', 'Inventory tag', 'Your Story Block inventory (equipment, consumables, loot).'),
                    row('Return to story', 'Sent for you after a fight so the narration comes straight away. Empty: send nothing.', returnMessage, 'rpg_battle_return'),
                ]),
            ]),
        ]),
    ]);
    sync();
    syncTerms();
    syncFlavour();
    refreshHints();
    container.replaceChildren(root);
    return {
        update(next) {
            current = structuredClone(next);
            refreshHints();
        },
        /** Show or hide the Character Sheet notice (the glue checks it on every refresh). */
        setSheetConflict(on) { conflict.hidden = !on; },
        /** Who the story follows now per area ({ [area]: { mine, name } }, or null for nothing shown). */
        setSources,
        /** Show a Source of truth choice made elsewhere (Story Suite's overlay); unknown ones are ignored. */
        setTruth(area, value) {
            const select = truthSelects[area];
            if (!select || !TRUTH_OPTIONS.some(option => option.value === value)) return;
            select.value = value;
            current.sourceOfTruth = { ...truth, ...(current.sourceOfTruth ?? {}), [area]: value };
            refreshHints();
        },
        /** Show the on/off switch as set elsewhere (Story Suite's overlay). */
        setEnabled(on) {
            enabled.checked = Boolean(on);
            current.enabled = Boolean(on);
        },
        /** Show or hide the "Manage all in Story Suite" link (the glue checks it on every suite change). */
        setSuiteLink(on) { suite.hidden = !on; },
    };
}

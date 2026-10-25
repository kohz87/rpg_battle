// Combat and narrative rescue use the same effect scope rules.
import { scopeOfPart } from '../fight/interpret.js';
export function canRescue(effect, rescuer, rescued) {
    if (!effect || !['heal', 'shield'].includes(effect.op)) return false;
    const scope = scopeOfPart(effect);
    return scope === 'self' ? rescuer === rescued : scope === 'ally' || scope === 'allies';
}

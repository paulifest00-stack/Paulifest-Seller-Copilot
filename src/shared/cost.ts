/** Values accepted by the inline cost editor. Empty input never means zero. */
export function parseCostInput(text: string): number | null {
    const input = text.trim().replace(/^R\$\s*/, '');
    if (input.includes(',') && !/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(input))
        return null;
    const normalized = input.includes(',') ? input.replace(/\./g, '').replace(',', '.') : input;
    if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(normalized))
        return null;
    const value = Number(normalized);
    return validCost(value) ? value : null;
}
export function validCost(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000000 && Math.abs(value * 100 - Math.round(value * 100)) < .00001;
}

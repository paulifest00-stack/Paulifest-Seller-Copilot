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
/** Values accepted by the inline stock editor. Empty input never means zero. */
export function parseStockInput(text: string): number | null {
    const input = text.trim().replace(/\s*(?:un(?:id(?:ades?)?)?|und)\.?$/i, '').trim();
    if (!input) return null;
    if (input.includes(',') && !/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(input))
        return null;
    const normalized = input.includes(',')
        ? input.replace(/\./g, '').replace(',', '.')
        : /^\d{1,3}(?:\.\d{3})+$/.test(input)
            ? input.replace(/\./g, '')
            : input;
    if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(normalized))
        return null;
    const value = Number(normalized);
    return validStock(value) ? value : null;
}
export function validStock(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000000 && Math.abs(value * 100 - Math.round(value * 100)) < .00001;
}


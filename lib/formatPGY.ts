export function formatPGY(pgy: number | null | undefined, pgyNote?: string | null): string {
    if (pgy == null) return '';
    if ((pgy === 6 || pgy === 7) && pgyNote) return pgyNote;
    return `PGY-${pgy}`;
}

// Value only, for places that already render a "PGY:" label
export function formatPGYValue(pgy: number | string | null | undefined, pgyNote?: string | null): string {
    if (pgy == null || pgy === '') return '';
    const n = Number(pgy);
    if ((n === 6 || n === 7) && pgyNote) return pgyNote.replace(/^PGY[\s-]*/i, ''); // "PGY 7 - second-year" -> "7 - second-year"
    return String(n);
}
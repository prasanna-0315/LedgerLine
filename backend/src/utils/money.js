// Money helpers. We never use floating-point for money.
// Idea: convert "123.45" into whole cents (12345), do maths on integers, convert back.

// Turns a user-supplied amount into cents. Returns null if invalid.
// Valid: positive, at most 13 digits before the dot, at most 2 after it.
function parseAmountToCents(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;

    const text = String(value).trim();
    if (!/^\d{1,13}(\.\d{1,2})?$/.test(text)) return null;

    const cents = decimalToCents(text);
    return cents > 0 ? cents : null;
}

// Turns a DECIMAL string from MySQL (like "-12.50" or "100.00") into cents.
function decimalToCents(text) {
    const negative = text.startsWith('-');
    const [whole, fraction = ''] = text.replace('-', '').split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
    return negative ? -cents : cents;
}

// Turns cents back into a string like "123.45".
function centsToString(cents) {
    const negative = cents < 0;
    const abs = Math.abs(cents);
    const whole = Math.floor(abs / 100);
    const fraction = String(abs % 100).padStart(2, '0');
    return `${negative ? '-' : ''}${whole}.${fraction}`;
}

module.exports = { parseAmountToCents, decimalToCents, centsToString };

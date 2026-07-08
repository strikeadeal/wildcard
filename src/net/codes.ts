/** No I, O, L, 0, 1 — every character is unambiguous when read aloud or typed. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Accepts raw codes, codes with separators/lowercase, or a pasted join link. */
export function normalizeCode(input: string): string | null {
  let text = input.trim();
  const linkMatch = text.match(/#\/join\/([^/?\s]+)/);
  if (linkMatch) text = linkMatch[1]!;
  const code = text.replace(/[\s-]/g, '').toUpperCase();
  if (code.length !== 5) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function codeToPeerId(code: string): string {
  return 'wildcard-' + code;
}

/** Field-friendly validation for the join-code input: null while empty or valid. */
export function validateCode(input: string): string | null {
  if (!input.trim()) return null;
  return normalizeCode(input)
    ? null
    : 'Use 5 letters or numbers, excluding I, O, L, 0 and 1.';
}

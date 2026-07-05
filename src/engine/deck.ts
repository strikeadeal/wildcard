import type { Card, CardValue, Color } from './types';

export const COLORS: Color[] = ['red', 'yellow', 'green', 'blue'];

const ONE_PER_COLOR: CardValue[] = ['0'];
const TWO_PER_COLOR: CardValue[] = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'
];

/** mulberry32 — small deterministic PRNG, plenty for card shuffling. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const color of COLORS) {
    for (const value of ONE_PER_COLOR) cards.push({ id: id++, color, value });
    for (let copy = 0; copy < 2; copy++) {
      for (const value of TWO_PER_COLOR) cards.push({ id: id++, color, value });
    }
  }
  for (let i = 0; i < 4; i++) cards.push({ id: id++, color: null, value: 'wild' });
  for (let i = 0; i < 4; i++) cards.push({ id: id++, color: null, value: 'wild4' });
  return cards;
}

/** Fisher–Yates on a copy. */
export function shuffle<T>(items: T[], random: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i]!, arr[j]!] = [arr[j]!, arr[i]!];
  }
  return arr;
}

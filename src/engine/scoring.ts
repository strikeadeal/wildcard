import type { Card } from './types';

export function handPoints(hand: Card[]): number {
  let total = 0;
  for (const c of hand) {
    if (c.value === 'wild' || c.value === 'wild4') total += 50;
    else if (c.value === 'skip' || c.value === 'reverse' || c.value === 'draw2') total += 20;
    else total += Number(c.value);
  }
  return total;
}

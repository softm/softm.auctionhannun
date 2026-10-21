// Select the card covering the reading line, or the closest visible card.
export function cardAtReadingLine(cards, top, bottom) {
  if (bottom <= top) return null;
  const line = top + Math.min(160, (bottom - top) * .35);
  const visible = cards.filter(card => card.bottom > top && card.top < bottom);
  return visible.reduce((best, card) => {
    const distance = value => value.top <= line && value.bottom >= line ? 0 : Math.min(Math.abs(value.top - line), Math.abs(value.bottom - line));
    return !best || distance(card) < distance(best) ? card : best;
  }, null)?.id || null;
}

export function createScrollSelection({ select, delay = 250, schedule = setTimeout, cancel = clearTimeout }) {
  let timer, generation = 0;
  return {
    queue(read) {
      cancel(timer); const current = ++generation;
      timer = schedule(() => { if (current !== generation) return; const id = read(); if (id) select(id); }, delay);
    },
    cancel() { ++generation; cancel(timer); }
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { cardAtReadingLine, createScrollSelection } from '../list-map-sync.js';

test('desktop selects the card covering the visible reading line', () => {
  const cards = [{ id: 'above', top: -200, bottom: 60 }, { id: 'current', top: 74, bottom: 334 }, { id: 'next', top: 348, bottom: 608 }];
  assert.equal(cardAtReadingLine(cards, 76, 800), 'current');
  assert.equal(cardAtReadingLine(cards.map(c => ({ ...c, top: c.top - 274, bottom: c.bottom - 274 })), 76, 800), 'next');
});

test('mobile ignores cards hidden behind the sticky map and bottom navigation', () => {
  assert.equal(cardAtReadingLine([{ id: 'hidden', top: 100, bottom: 390 }, { id: 'visible', top: 404, bottom: 850 }, { id: 'below', top: 864, bottom: 1200 }], 394, 778), 'visible');
});

test('gaps choose the nearest visible card, empty or covered lists select nothing', () => {
  assert.equal(cardAtReadingLine([{ id: 'a', top: 80, bottom: 200 }, { id: 'b', top: 280, bottom: 400 }], 76, 800), 'a');
  assert.equal(cardAtReadingLine([{ id: 'offscreen', top: 900, bottom: 1100 }], 76, 800), null);
  assert.equal(cardAtReadingLine([], 76, 800), null);
  assert.equal(cardAtReadingLine([{ id: 'a', top: 80, bottom: 200 }], 400, 300), null);
});

test('rapid scroll uses only the latest position and cancellation invalidates queued work', () => {
  const tasks = [], selected = [];
  const sync = createScrollSelection({ select: id => selected.push(id), schedule: (run, delay) => { assert.equal(delay, 250); tasks.push(run); return tasks.length; }, cancel: () => {} });
  sync.queue(() => 'old'); sync.queue(() => 'latest');
  tasks[0](); tasks[1]();
  assert.deepEqual(selected, ['latest']);
  sync.queue(() => 'filtered-out'); sync.cancel(); tasks[2]();
  sync.queue(() => null); tasks[3]();
  assert.deepEqual(selected, ['latest']);
});

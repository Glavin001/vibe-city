import { describe, it, expect, beforeAll } from 'vitest';
import { planJsonOnWorker, planGoalOnWorker } from '../lib/fluidhtn';

let dotnetUrl: string;

beforeAll(async () => {
  dotnetUrl = new URL('../../public/fluidhtn/_framework/dotnet.js', import.meta.url).href;
});

function parseLines(planText: string) {
  if (planText && planText.toLowerCase().includes('timeout')) {
    throw new Error(`Plan contains TIMEOUT:\n${planText}`);
  }
  return (planText || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
}

function expectInOrder(lines: string[], tokens: string[]) {
  let prev = -1;
  for (const t of tokens) {
    const idx = lines.indexOf(t);
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(prev);
    prev = idx;
  }
}

describe('Bunker Planner', () => {
  it('adjacent move via goal (courtyard -> bunker_door)', async () => {
    const res = await planGoalOnWorker(dotnetUrl, { goal: { agentAt: 'bunker_door' } });
    const lines = (res || '').split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toBe('MOVE bunker_door');
  });

  it('goal key hasKey should generate pickup sequence', async () => {
    const res = await planGoalOnWorker(dotnetUrl, { goal: { hasKey: true } });
    const lines = (res || '').split('\n').filter(Boolean);
    // Should include moving to table then pickup
    expect(lines[0]).toBe('MOVE table_area');
    expect(lines).toContain('PICKUP_KEY');
  });
});

describe('FluidHTN WASM goals (ported)', () => {
  it('adjacent move via goal (courtyard -> bunker_door)', async () => {
    const planText = await planGoalOnWorker(dotnetUrl, { goal: { agentAt: 'bunker_door' } });
    const lines = parseLines(planText);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toBe('MOVE bunker_door');
  });

  it('hasKey plan includes moving to table and pickup', async () => {
    const planText = await planGoalOnWorker(dotnetUrl, { goal: { hasKey: true } });
    const lines = parseLines(planText);
    expect(lines).toContain('PICKUP_KEY');
    expectInOrder(lines, ['MOVE table_area', 'PICKUP_KEY']);
  });

  it('hasC4 plan unlocks storage and picks up C4', async () => {
    const planText = await planGoalOnWorker(dotnetUrl, { goal: { hasC4: true } });
    const lines = parseLines(planText);
    expectInOrder(lines, ['MOVE table_area', 'PICKUP_KEY']);
    expect(lines).toContain('UNLOCK_STORAGE');
    expect(lines).toContain('PICKUP_C4');
    expectInOrder(lines, ['UNLOCK_STORAGE', 'PICKUP_C4']);
  });

  it('bunkerBreached plan places C4 and detonates', async () => {
    const planText = await planGoalOnWorker(dotnetUrl, { goal: { bunkerBreached: true } });
    const lines = parseLines(planText);
    expect(lines).toContain('PLACE_C4');
    expect(lines).toContain('DETONATE');
    expectInOrder(lines, ['PLACE_C4', 'DETONATE']);
  });

  it('hasStar plan completes full mission and picks up star', async () => {
    const planText = await planGoalOnWorker(dotnetUrl, { goal: { hasStar: true } });
    const lines = parseLines(planText);
    expectInOrder(lines, [
      'MOVE table_area',
      'PICKUP_KEY',
      'UNLOCK_STORAGE',
      'PICKUP_C4',
      'PLACE_C4',
      'DETONATE',
      'MOVE bunker_interior',
      'MOVE star_pos',
      'PICKUP_STAR',
    ]);
    expect(lines[lines.length - 1]).toBe('PICKUP_STAR');
  });

  it('hasStar + agentAt=table_area returns with star to table in one plan', async () => {
    const planText = await planGoalOnWorker(dotnetUrl, { goal: { hasStar: true, agentAt: 'table_area' } });
    const lines = parseLines(planText);
    // Ensure we pick up the star and then end with an explicit MOVE table_area
    const idxStar = lines.indexOf('PICKUP_STAR');
    const idxReturn = lines.lastIndexOf('MOVE table_area');
    expect(idxStar).toBeGreaterThan(-1);
    expect(idxReturn).toBeGreaterThan(idxStar);
    expect(lines[lines.length - 1]).toBe('MOVE table_area');
  });
});






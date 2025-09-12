import { describe, it, expect, beforeAll } from 'vitest';
import { planJsonOnWorker, planGoalOnWorker, PlanResultJson } from '../lib/fluidhtn';

let dotnetUrl: string;

beforeAll(async () => {
  // Use freshly built AppBundle location
  dotnetUrl = new URL('../../public/planner/_framework/dotnet.js', import.meta.url).href;
});

function getPlan(result: PlanResultJson) {
  if (result.error && result.error.toLowerCase().includes('timeout')) {
    throw new Error(`Planner timeout: ${result.error}`);
  }
  return result.plan || [];
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
    const lines = getPlan(res);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toBe('MOVE bunker_door');
  });

  it('goal key hasKey should generate pickup sequence', async () => {
    const res = await planGoalOnWorker(dotnetUrl, { goal: { hasKey: true } });
    const lines = getPlan(res);
    // Should include moving to table then pickup
    expect(lines[0]).toBe('MOVE table_area');
    expect(lines).toContain('PICKUP_KEY');
  });
});

describe('FluidHTN WASM goals (ported)', () => {
  it('adjacent move via goal (courtyard -> bunker_door)', async () => {
    const result = await planGoalOnWorker(dotnetUrl, { goal: { agentAt: 'bunker_door' } });
    const lines = getPlan(result);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toBe('MOVE bunker_door');
  });

  it('hasKey plan includes moving to table and pickup', async () => {
    const result = await planGoalOnWorker(dotnetUrl, { goal: { hasKey: true } });
    const lines = getPlan(result);
    expect(lines).toContain('PICKUP_KEY');
    expectInOrder(lines, ['MOVE table_area', 'PICKUP_KEY']);
  });

  it('hasC4 plan unlocks storage and picks up C4', async () => {
    const result = await planGoalOnWorker(dotnetUrl, { goal: { hasC4: true } });
    const lines = getPlan(result);
    expectInOrder(lines, ['MOVE table_area', 'PICKUP_KEY']);
    expect(lines).toContain('UNLOCK_STORAGE');
    expect(lines).toContain('PICKUP_C4');
    expectInOrder(lines, ['UNLOCK_STORAGE', 'PICKUP_C4']);
  });

  it('bunkerBreached plan places C4 and detonates', async () => {
    const result = await planGoalOnWorker(dotnetUrl, { goal: { bunkerBreached: true } });
    const lines = getPlan(result);
    expect(lines).toContain('PLACE_C4');
    expect(lines).toContain('DETONATE');
    expectInOrder(lines, ['PLACE_C4', 'DETONATE']);
  });

  it('hasStar plan completes full mission and picks up star', async () => {
    const result = await planGoalOnWorker(dotnetUrl, { goal: { hasStar: true } });
    const lines = getPlan(result);
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
    const result = await planGoalOnWorker(dotnetUrl, { goal: { hasStar: true, agentAt: 'table_area' } });
    const lines = getPlan(result);
    // Ensure we pick up the star and then end with an explicit MOVE table_area
    const idxStar = lines.indexOf('PICKUP_STAR');
    const idxReturn = lines.lastIndexOf('MOVE table_area');
    expect(idxStar).toBeGreaterThan(-1);
    expect(idxReturn).toBeGreaterThan(idxStar);
    expect(lines[lines.length - 1]).toBe('MOVE table_area');
  });
});






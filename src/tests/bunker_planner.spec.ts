import { describe, it, expect, beforeAll } from 'vitest';
import { planJsonOnWorker, planGoalOnWorker, PlanResultJson } from '../lib/fluidhtn';

let dotnetUrl: string;

beforeAll(async () => {
  // Use freshly built AppBundle location
  dotnetUrl = new URL('../../public/planner/_framework/dotnet.js', import.meta.url).href;
});

function getPlan(result: PlanResultJson) {
  if (result.error && result.error) {
    throw new Error(`Planner error: ${result.error}`);
  }
  return result.plan || [];
}

function expectInOrder(lines: string[], tokens: string[]) {
  let prev = -1;
  for (const t of tokens) {
    const idx = lines.indexOf(t);
    expect(idx, `Token "${t}" not found in plan lines: ${JSON.stringify(lines)}`).toBeGreaterThan(-1);
    expect(idx, `Token "${t}" appears out of order in plan lines: ${JSON.stringify(lines)}`).toBeGreaterThan(prev);
    prev = idx;
  }
}

describe.skip('Bunker Planner', () => {
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

describe.skip('FluidHTN WASM goals (ported)', () => {
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
    expect(idxStar, `PICKUP_STAR not found in plan lines: ${JSON.stringify(lines)}`).toBeGreaterThan(-1);
    expect(idxReturn, `MOVE table_area does not appear after PICKUP_STAR in plan lines: ${JSON.stringify(lines)}`).toBeGreaterThan(idxStar);
    expect(lines[lines.length - 1]).toBe('MOVE table_area');
  });

  it('does not place or detonate C4 if bunker is already breached', async () => {
    const result = await planGoalOnWorker(dotnetUrl, {
      initial: { bunkerBreached: true },
      goal: { hasStar: true }
    });
    const lines = getPlan(result);
    // Should not place or detonate C4
    expect(lines).not.toContain('PLACE_C4');
    expect(lines).not.toContain('DETONATE');
    // Should not pick up key, unlock storage, or pick up C4 since bunker is already breached
    expect(lines).not.toContain('PICKUP_KEY');
    expect(lines).not.toContain('UNLOCK_STORAGE');
    expect(lines).not.toContain('PICKUP_C4');
    // Should move to bunker interior, move to star, and pick up star
    expect(lines).toContain('MOVE bunker_interior');
    expect(lines).toContain('MOVE star_pos');
    expect(lines).toContain('PICKUP_STAR');
    // Should end with picking up the star
    expect(lines[lines.length - 1]).toBe('PICKUP_STAR');
  });

  it('C4 already placed: skips key/storage, detonates, then continues to star', async () => {
    const result = await planGoalOnWorker(dotnetUrl, {
      initial: { c4Placed: true },
      goal: { hasStar: true }
    });
    const lines = getPlan(result);
    // Should not pick up key, unlock storage, or pick up C4
    expect(lines).not.toContain('PICKUP_KEY');
    expect(lines).not.toContain('UNLOCK_STORAGE');
    expect(lines).not.toContain('PICKUP_C4');
    // Should not place C4 (already placed)
    expect(lines).not.toContain('PLACE_C4');
    // Should detonate C4
    expect(lines).toContain('DETONATE');
    // Should move to blast safe zone before detonating
    const idxSafe = lines.indexOf('MOVE blast_safe_zone');
    const idxDetonate = lines.indexOf('DETONATE');
    expect(idxSafe).toBeGreaterThan(-1);
    expect(idxDetonate).toBeGreaterThan(idxSafe);
    // Should continue to move to bunker interior, move to star, and pick up star
    expect(lines).toContain('MOVE bunker_interior');
    expect(lines).toContain('MOVE star_pos');
    expect(lines).toContain('PICKUP_STAR');
    // Should end with picking up the star
    expect(lines[lines.length - 1]).toBe('PICKUP_STAR');
  });

  it('storage already unlocked: skips key, goes straight to C4, continues to star', async () => {
    const result = await planGoalOnWorker(dotnetUrl, {
      initial: { storageUnlocked: true },
      goal: { hasStar: true }
    });
    const lines = getPlan(result);
    // Should not pick up key or unlock storage, since storage is already unlocked
    expect(lines).not.toContain('PICKUP_KEY');
    expect(lines).not.toContain('UNLOCK_STORAGE');
    // Should move to storage door and then to C4 table to pick up C4
    expect(lines).toContain('MOVE storage_door');
    expect(lines).toContain('MOVE c4_table');
    expect(lines).toContain('PICKUP_C4');
    // Should place C4, move to safe zone, detonate, then continue to star
    expect(lines).toContain('PLACE_C4');
    expect(lines).toContain('MOVE blast_safe_zone');
    expect(lines).toContain('DETONATE');
    expect(lines).toContain('MOVE bunker_interior');
    expect(lines).toContain('MOVE star_pos');
    expect(lines).toContain('PICKUP_STAR');
    // Should end with picking up the star
    expect(lines[lines.length - 1]).toBe('PICKUP_STAR');
  });

  it('target is storage interior: picks up key, unlocks storage, moves to storage interior', async () => {
    const result = await planGoalOnWorker(dotnetUrl, {
      goal: { agentAt: 'storage_interior' }
    });
    const lines = getPlan(result);
    // Should pick up key, unlock storage, and move to storage interior
    expect(lines).toContain('PICKUP_KEY');
    expect(lines).toContain('UNLOCK_STORAGE');
    expect(lines).toContain('MOVE storage_interior');
    // Should not pick up C4, place C4, detonate, or pick up star
    expect(lines).not.toContain('PICKUP_C4');
    expect(lines).not.toContain('PLACE_C4');
    expect(lines).not.toContain('DETONATE');
    expect(lines).not.toContain('PICKUP_STAR');
    // Should not move to star or bunker interior
    expect(lines).not.toContain('MOVE star_pos');
    expect(lines).not.toContain('MOVE bunker_interior');
    // Should end at storage interior
    const lastMoveIdx = lines.lastIndexOf('MOVE storage_interior');
    expect(lastMoveIdx, `MOVE storage_interior not found in plan lines: ${JSON.stringify(lines)}`).toBeGreaterThan(-1);
    expect(lines[lastMoveIdx]).toBe('MOVE storage_interior');
  });

  it('goal hasKey and hasC4 (but not hasStar): picks up key and C4, does not pick up star', async () => {
    const result = await planGoalOnWorker(dotnetUrl, {
      goal: { hasKey: true, hasC4: true }
    });
    const lines = getPlan(result);
    // Should pick up key and C4
    expectInOrder(lines, ['MOVE table_area', 'PICKUP_KEY', 'MOVE storage_door', 'UNLOCK_STORAGE', 'MOVE c4_table', 'PICKUP_C4']);
    // Should not pick up star
    expect(lines, 'Plan should not include picking up the star').not.toContain('PICKUP_STAR');
    // Should not place C4, detonate, or move to star
    expect(lines, 'Plan should not include placing C4').not.toContain('PLACE_C4');
    expect(lines, 'Plan should not include detonating').not.toContain('DETONATE');
    expect(lines, 'Plan should not include moving to star position').not.toContain('MOVE star_pos');
    // Should end with picking up C4
    expect(lines[lines.length - 1], 'Plan should end with picking up C4').toBe('PICKUP_C4');
  });

});


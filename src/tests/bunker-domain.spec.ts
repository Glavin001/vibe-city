import { performance } from "node:perf_hooks";
import { describe, expect, test } from "vitest";
import { planGoal } from "../lib/bunker-domain";

function expectInOrder(lines: string[], tokens: string[]) {
  let prevIndex = -1;
  for (const token of tokens) {
    const index = lines.indexOf(token);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeGreaterThan(prevIndex);
    prevIndex = index;
  }
}

describe("Bunker Domain Planning", () => {
  test("adjacent move via goal (courtyard -> bunker_door)", () => {
    const lines = planGoal({ agentAt: "bunker_door" });
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toBe("MOVE bunker_door");
  });

  test("goal hasKey should generate pickup sequence", () => {
    const lines = planGoal({ hasKey: true });
    expect(lines[0]).toBe("MOVE table_area");
    expect(lines).toContain("PICKUP_KEY");
  });

  test("hasC4 plan unlocks storage and picks up C4", () => {
    const lines = planGoal({ hasC4: true });
    expectInOrder(lines, ["MOVE table_area", "PICKUP_KEY"]);
    expect(lines).toContain("UNLOCK_STORAGE");
    expect(lines).toContain("PICKUP_C4");
    expectInOrder(lines, ["UNLOCK_STORAGE", "PICKUP_C4"]);
  });

  test("bunkerBreached plan places C4 and detonates", () => {
    const lines = planGoal({ bunkerBreached: true });
    expect(lines).toContain("PLACE_C4");
    expect(lines).toContain("DETONATE");
    expectInOrder(lines, ["PLACE_C4", "DETONATE"]);
  });

  test("hasStar plan completes full mission and picks up star", () => {
    const lines = planGoal({ hasStar: true });
    expectInOrder(lines, [
      "MOVE table_area",
      "PICKUP_KEY",
      "UNLOCK_STORAGE",
      "PICKUP_C4",
      "PLACE_C4",
      "DETONATE",
      "MOVE bunker_interior",
      "MOVE star_pos",
      "PICKUP_STAR",
    ]);
    expect(lines[lines.length - 1]).toBe("PICKUP_STAR");
  });

  test("hasStar + agentAt=table_area returns with star to table in one plan", () => {
    const lines = planGoal({ hasStar: true, agentAt: "table_area" });
    const starIndex = lines.indexOf("PICKUP_STAR");
    const returnIndex = lines.lastIndexOf("MOVE table_area");
    expect(starIndex).toBeGreaterThanOrEqual(0);
    expect(returnIndex).toBeGreaterThan(starIndex);
    expect(lines[lines.length - 1]).toBe("MOVE table_area");
  });

  test("does not place or detonate C4 if bunker already breached", () => {
    const lines = planGoal(
      { hasStar: true },
      { initial: { bunkerBreached: true } },
    );
    expect(lines).not.toContain("PLACE_C4");
    expect(lines).not.toContain("DETONATE");
    expect(lines).not.toContain("PICKUP_KEY");
    expect(lines).not.toContain("UNLOCK_STORAGE");
    expect(lines).not.toContain("PICKUP_C4");
    expect(lines).toContain("MOVE bunker_interior");
    expect(lines).toContain("MOVE star_pos");
    expect(lines).toContain("PICKUP_STAR");
    expect(lines[lines.length - 1]).toBe("PICKUP_STAR");
  });

  test("C4 already placed: skips key/storage, detonates, then continues to star", () => {
    const lines = planGoal({ hasStar: true }, { initial: { c4Placed: true } });
    expect(lines).not.toContain("PICKUP_KEY");
    expect(lines).not.toContain("UNLOCK_STORAGE");
    expect(lines).not.toContain("PICKUP_C4");
    expect(lines).not.toContain("PLACE_C4");
    expect(lines).toContain("DETONATE");
    const safeIndex = lines.indexOf("MOVE blast_safe_zone");
    const detonateIndex = lines.indexOf("DETONATE");
    expect(safeIndex).toBeGreaterThanOrEqual(0);
    expect(detonateIndex).toBeGreaterThan(safeIndex);
    expect(lines).toContain("MOVE bunker_interior");
    expect(lines).toContain("MOVE star_pos");
    expect(lines).toContain("PICKUP_STAR");
    expect(lines[lines.length - 1]).toBe("PICKUP_STAR");
  });

  test("storage already unlocked: skips key, goes straight to C4, continues to star", () => {
    const lines = planGoal(
      { hasStar: true },
      { initial: { storageUnlocked: true } },
    );
    expect(lines).not.toContain("PICKUP_KEY");
    expect(lines).not.toContain("UNLOCK_STORAGE");
    expect(lines).toContain("MOVE storage_door");
    expect(lines).toContain("MOVE c4_table");
    expect(lines).toContain("PICKUP_C4");
    expect(lines).toContain("PLACE_C4");
    expect(lines).toContain("MOVE blast_safe_zone");
    expect(lines).toContain("DETONATE");
    expect(lines).toContain("MOVE bunker_interior");
    expect(lines).toContain("MOVE star_pos");
    expect(lines).toContain("PICKUP_STAR");
    expect(lines[lines.length - 1]).toBe("PICKUP_STAR");
  });

  test("target is storage interior: picks up key, unlocks storage, moves to storage interior", () => {
    const lines = planGoal({ agentAt: "storage_interior" });
    expect(lines).toContain("PICKUP_KEY");
    expect(lines).toContain("UNLOCK_STORAGE");
    expect(lines).toContain("MOVE storage_interior");
    expect(lines).not.toContain("PICKUP_C4");
    expect(lines).not.toContain("PLACE_C4");
    expect(lines).not.toContain("DETONATE");
    expect(lines).not.toContain("PICKUP_STAR");
    expect(lines).not.toContain("MOVE star_pos");
    expect(lines).not.toContain("MOVE bunker_interior");
    const lastMoveIndex = lines.lastIndexOf("MOVE storage_interior");
    expect(lastMoveIndex).toBeGreaterThanOrEqual(0);
    expect(lines[lastMoveIndex]).toBe("MOVE storage_interior");
  });

  test("goal hasKey and hasC4 picks up key and C4", () => {
    const lines = planGoal({ hasKey: true, hasC4: true });
    expectInOrder(lines, [
      "MOVE table_area",
      "PICKUP_KEY",
      "MOVE storage_door",
      "UNLOCK_STORAGE",
      "MOVE c4_table",
      "PICKUP_C4",
    ]);
    expect(lines).not.toContain("PICKUP_STAR");
    expect(lines).not.toContain("PLACE_C4");
    expect(lines).not.toContain("DETONATE");
    expect(lines).not.toContain("MOVE star_pos");
    expect(lines[lines.length - 1]).toBe("PICKUP_C4");
  });

  test("performance baseline for hasStar goal", () => {
    const baseline = planGoal({ hasStar: true });
    expect(baseline.length).toBeGreaterThan(0);

    const iterations = 2000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      planGoal({ hasStar: true });
    }
    const totalMs = performance.now() - start;
    const avgMs = totalMs / iterations;
    const fps = avgMs === 0 ? Number.POSITIVE_INFINITY : 1000 / avgMs;

    // eslint-disable-next-line no-console -- Explicitly requested performance logging
    console.log(
      `[BunkerPerf] iterations=${iterations} total=${totalMs.toFixed(2)}ms avg=${avgMs.toFixed(4)}ms fps=${fps.toFixed(2)}`,
    );

    expect(Number.isFinite(avgMs) && avgMs >= 0).toBe(true);
  });
});

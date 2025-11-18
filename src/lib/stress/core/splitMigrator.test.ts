import { describe, expect, it } from "vitest";

import type { ExistingBodyState, PlannerChild } from "./splitMigrator";
import { planSplitMigration } from "./splitMigrator";

const makeBody = (
  handle: number,
  nodeIndices: number[],
  isFixed = false,
): ExistingBodyState => ({
  handle,
  nodeIndices: new Set(nodeIndices),
  isFixed,
});

const makeChild = (
  index: number,
  nodes: number[],
  isSupport = false,
): PlannerChild => ({
  index,
  actorIndex: 100 + index,
  nodes,
  isSupport,
});

describe("planSplitMigration", () => {
  it("reuses dynamic body for the child with the largest overlap", () => {
    const bodies = [makeBody(1, [0, 1, 2, 3, 4, 5])];
    const children = [
      makeChild(0, [0, 1, 2, 3]),
      makeChild(1, [4, 5]),
    ];
    const plan = planSplitMigration(bodies, children);
    expect(plan.reuse).toEqual([{ childIndex: 0, bodyHandle: 1 }]);
    expect(plan.create).toEqual([{ childIndex: 1 }]);
  });

  it("forces support children to stay on fixed bodies", () => {
    const bodies = [makeBody(10, [0, 1, 2], true)];
    const children = [
      makeChild(0, [0], true),
      makeChild(1, [1, 2]),
    ];
    const plan = planSplitMigration(bodies, children);
    expect(plan.reuse).toEqual([{ childIndex: 0, bodyHandle: 10 }]);
    expect(plan.create).toEqual([{ childIndex: 1 }]);
  });

  it("handles multiple bodies via Hungarian assignment", () => {
    const bodies = [
      makeBody(1, [0, 1, 2, 3]),
      makeBody(2, [4, 5, 6, 7]),
    ];
    const children = [
      makeChild(0, [0, 1, 2]),
      makeChild(1, [4, 5, 6]),
      makeChild(2, [3, 4]), // overlaps both bodies, low priority
    ];
    const plan = planSplitMigration(bodies, children, {
      onDuration: () => {},
    });
    expect(plan.reuse).toEqual([
      { childIndex: 0, bodyHandle: 1 },
      { childIndex: 1, bodyHandle: 2 },
    ]);
    expect(plan.create).toEqual([{ childIndex: 2 }]);
  });

  it("reuses exact matches via hashing before Hungarian", () => {
    const bodies = [
      makeBody(1, [0, 1, 2]),
      makeBody(2, [3, 4, 5]),
    ];
    const children = [
      makeChild(0, [3, 4, 5]),
      makeChild(1, [0, 1, 2]),
    ];
    const plan = planSplitMigration(bodies, children);
    expect(plan.reuse).toEqual([
      { childIndex: 0, bodyHandle: 2 },
      { childIndex: 1, bodyHandle: 1 },
    ]);
    expect(plan.create).toEqual([]);
  });

  it("handles large sets repeatedly", () => {
    const bodies = Array.from({ length: 50 }, (_, i) =>
      makeBody(i + 1, Array.from({ length: 20 }, (_, j) => i * 20 + j)),
    );
    const children = bodies.map((body, idx) =>
      makeChild(idx, Array.from(body.nodeIndices)),
    );
    const timings: number[] = [];
    for (let i = 0; i < 100; i++) {
      planSplitMigration(bodies, children, {
        onDuration: (ms) => timings.push(ms),
      });
    }
    expect(timings.length).toBe(100);
    expect(timings.every((ms) => Number.isFinite(ms))).toBe(true);
  });
});


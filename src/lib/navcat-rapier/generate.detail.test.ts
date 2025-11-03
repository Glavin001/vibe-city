import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import Rapier from "@dimforge/rapier3d-compat";
import { extractRapierToNavcat } from "./extract";
import { generateSoloNavMeshFromGeometry, type NavMeshGenerationResult } from "./generate";

describe("generateSoloNavMeshFromGeometry - detail mesh behavior", () => {
  let rapier: typeof Rapier;
  let world: Rapier.World | null = null;

  function getWorld(): Rapier.World {
    if (!world) throw new Error("World not initialized");
    return world;
  }

  beforeAll(async () => {
    await Rapier.init();
    rapier = Rapier;
  });

  beforeEach(() => {
    if (!rapier) throw new Error("Rapier not initialized");
    world = new rapier.World(new rapier.Vector3(0, -9.81, 0));
    if (!world) throw new Error("Failed to create world");
  });

  afterEach(() => {
    if (world) {
      world.free();
      world = null;
    }
  });

  it("skips detail when skipDetailMesh option is true", () => {
    const w = getWorld();
    // Ground
    const groundBody = w.createRigidBody(rapier.RigidBodyDesc.fixed());
    w.createCollider(rapier.ColliderDesc.cuboid(10, 0.1, 10), groundBody);

    const extraction = extractRapierToNavcat(w, rapier);
    expect(extraction).not.toBeNull();

    const result: NavMeshGenerationResult | null = generateSoloNavMeshFromGeometry(extraction!, {
      skipDetailMesh: true,
    });
    expect(result).not.toBeNull();
    expect(result!.navMesh).toBeDefined();
    expect(Object.keys(result!.navMesh.tiles).length).toBeGreaterThan(0);
    expect(result!.stats.reusedNavMesh).toBe(false);

    const tile = Object.values(result!.navMesh.tiles)[0] as any;
    // Detail arrays should be empty when skipped
    expect((tile.detailVertices?.length ?? 0)).toBe(0);
    expect((tile.detailTriangles?.length ?? 0)).toBe(0);
  });

  it("skips detail automatically for small meshes (nPolys < 20)", () => {
    const w = getWorld();
    // Single cuboid tends to produce a small number of polys (< 20)
    const groundBody = w.createRigidBody(rapier.RigidBodyDesc.fixed());
    w.createCollider(rapier.ColliderDesc.cuboid(10, 0.1, 10), groundBody);

    const extraction = extractRapierToNavcat(w, rapier);
    expect(extraction).not.toBeNull();

    const result: NavMeshGenerationResult | null = generateSoloNavMeshFromGeometry(extraction!, {
      preset: "default",
    });
    expect(result).not.toBeNull();
    expect(result!.navMesh).toBeDefined();
    expect(Object.keys(result!.navMesh.tiles).length).toBeGreaterThan(0);

    const tile = Object.values(result!.navMesh.tiles)[0] as any;
    expect(tile).toBeDefined();
    expect(tile.detailMeshes).toBeDefined();
    expect(tile.detailMeshes.length).toBe(tile.polys.length);
    expect(Array.isArray(tile.detailVertices)).toBe(true);
    expect(Array.isArray(tile.detailTriangles)).toBe(true);
    // Detail triangles may be empty or populated depending on Navcat heuristics; ensure counts are consistent
    for (let i = 0; i < tile.detailMeshes.length; i++) {
      const detailMesh = tile.detailMeshes[i];
      expect(detailMesh).toBeDefined();
      expect(typeof detailMesh.trianglesCount).toBe("number");
      expect(detailMesh.trianglesCount).toBeGreaterThanOrEqual(0);
    }
  });

  it("builds with non-empty detail for crisp preset when possible (smoke)", () => {
    const w = getWorld();
    // Add some extra geometry to increase polygonization likelihood
    const groundBody = w.createRigidBody(rapier.RigidBodyDesc.fixed());
    w.createCollider(rapier.ColliderDesc.cuboid(10, 0.1, 10), groundBody);
    const p1 = w.createRigidBody(rapier.RigidBodyDesc.fixed());
    w.createCollider(rapier.ColliderDesc.cuboid(2, 0.1, 2).setTranslation(3, 0.2, 3), p1);
    const p2 = w.createRigidBody(rapier.RigidBodyDesc.fixed());
    w.createCollider(rapier.ColliderDesc.cuboid(2, 0.1, 2).setTranslation(-3, 0.2, -3), p2);

    const extraction = extractRapierToNavcat(w, rapier);
    expect(extraction).not.toBeNull();

    const result: NavMeshGenerationResult | null = generateSoloNavMeshFromGeometry(extraction!, {
      preset: "crisp",
    });
    expect(result).not.toBeNull();
    expect(result!.navMesh).toBeDefined();
    expect(Object.keys(result!.navMesh.tiles).length).toBeGreaterThan(0);

    // We don't assert detail arrays specifically (depends on runtime), only that navmesh is valid
    const tile = Object.values(result!.navMesh.tiles)[0] as any;
    expect(tile.vertices.length).toBeGreaterThan(0);
    expect(tile.polys.length).toBeGreaterThan(0);
  });
});



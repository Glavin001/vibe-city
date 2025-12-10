import * as THREE from "three";
import { MATERIALS } from "./constants";
import { type BulletSegment, MaterialType } from "./types";

/**
 * Ballistics Math & Physics Logic
 *
 * 1. Penetration:
 *    Energy loss is modeled using a simplified Poncelet equation approximation for real-time.
 *    E_loss = Density * Distance * DragCoefficient
 *
 * 2. Refraction (Deflection):
 *    When entering a denser medium at an angle, the projectile tends to destabilize.
 *    Contrary to light (Snell's law), bullets often deflect *away* from the normal at high angles (ricochet)
 *    or destabilize *into* the material.
 *    We simulate 'tumbling' by adding noise to the vector based on material density and roughness.
 */

const MAX_BOUNCES = 8; // Increased bounces for more chaos
const MAX_DEPTH_CHECK = 2.0; // Max meters to check for wall thickness
const MIN_ENERGY = 5; // Joules/Velocity proxy where bullet stops
const MAX_ITERATIONS = 30; // Safety break for infinite energy mode
const PENETRATION_OFFSET = 0.001; // 1mm offset to avoid self-intersection but catch thin walls

// Helper to get random spread
const getDeflection = (
  direction: THREE.Vector3,
  factor: number
): THREE.Vector3 => {
  const spread = new THREE.Vector3(
    (Math.random() - 0.5) * factor,
    (Math.random() - 0.5) * factor,
    (Math.random() - 0.5) * factor
  );
  return direction.clone().add(spread).normalize();
};

export const calculateBulletPath = (
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  scene: THREE.Scene,
  initialEnergy = 1000,
  enableEnergyLoss = true // Toggle for infinite penetration
): BulletSegment[] => {
  const segments: BulletSegment[] = [];

  let currentPos = origin.clone();
  let currentDir = direction.clone().normalize();
  let currentEnergy = initialEnergy;
  let bounces = 0;
  let iterations = 0;

  // Gather valid colliders once.
  // CRITICAL FIX: We must filter out 'Line' objects (visual bullet tracers) because they
  // cause a crash in Three.js Raycaster when camera is undefined.
  // We only want to hit meshes that represent physical objects (walls, floor).
  const collidableObjects: THREE.Object3D[] = [];
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && child.visible) {
      // Check if it has materialType (Walls) or is a generic solid mesh (Floor with manually added type)
      // Also accept anything with userData.physics (Dynamic props)
      if (child.userData.materialType || child.userData.physics) {
        collidableObjects.push(child);
      }
    }
  });

  const raycaster = new THREE.Raycaster();

  while (
    currentEnergy > MIN_ENERGY &&
    bounces < MAX_BOUNCES &&
    iterations < MAX_ITERATIONS
  ) {
    iterations++;
    raycaster.set(currentPos, currentDir);

    // Intersect only the filtered physical objects
    const intersects = raycaster.intersectObjects(collidableObjects, false);

    // Get the first hit
    const hit = intersects[0];

    if (!hit) {
      // Goes into the void
      segments.push({
        start: currentPos.clone(),
        end: currentPos.clone().add(currentDir.clone().multiplyScalar(50)), // Draw far
        direction: currentDir.clone(),
        type: "air",
        energyAtStart: currentEnergy,
      });
      break;
    }

    const hitPoint = hit.point;
    const object = hit.object;

    // Add air segment
    segments.push({
      start: currentPos.clone(),
      end: hitPoint.clone(),
      direction: currentDir.clone(),
      type: "air",
      energyAtStart: currentEnergy,
      hitObjectUUID: object.uuid, // Important for applying physics impulse later
    });

    // 1. MATERIAL RESOLUTION
    const matType =
      (object.userData.materialType as MaterialType) || MaterialType.DRYWALL;
    const props = MATERIALS[matType];

    // 2. RICOCHET CALCULATION
    const normal =
      hit.face?.normal
        .clone()
        .transformDirection(object.matrixWorld)
        .normalize() || new THREE.Vector3(0, 1, 0);

    // Angle between -Ray and Normal. 0 = head on. 90 = graze.
    const angleOfIncidence =
      currentDir.clone().negate().angleTo(normal) * (180 / Math.PI);

    const grazingAngle = 90 - angleOfIncidence;

    // Reduced threshold to allow more penetration
    const ricochetThreshold = 5 + props.hardness * 10;

    if (grazingAngle < ricochetThreshold) {
      // RICOCHET
      const reflection = currentDir.clone().reflect(normal).normalize();

      // Apply some energy loss on bounce
      if (enableEnergyLoss) {
        currentEnergy *= 0.7;
      }

      // Deflect slightly based on roughness
      currentDir = getDeflection(reflection, props.roughness * 0.1);
      currentPos = hitPoint.clone().add(currentDir.multiplyScalar(PENETRATION_OFFSET)); // Advance slightly
      bounces++;

      // Add a tiny segment to show the bounce point clearly
      segments.push({
        start: hitPoint,
        end: hitPoint.clone().add(reflection.multiplyScalar(0.1)),
        direction: currentDir.clone(),
        type: "ricochet",
        energyAtStart: currentEnergy,
      });

      continue;
    }

    // 3. PENETRATION & REFRACTION
    // Raycast from *inside* to find exit
    const backCaster = new THREE.Raycaster();
    const deepPoint = hitPoint
      .clone()
      .add(currentDir.clone().multiplyScalar(MAX_DEPTH_CHECK));
    backCaster.set(deepPoint, currentDir.clone().negate());

    // We only care about checking the specific object we hit for thickness
    const backIntersects = backCaster.intersectObject(object, false);

    let exitPoint: THREE.Vector3;
    let thickness = 0.1; // Default fallback

    if (backIntersects.length > 0) {
      const exit = backIntersects[0];
      exitPoint = exit.point;
      thickness = exitPoint.distanceTo(hitPoint);
    } else {
      thickness = props.density < 2 ? 0.2 : 0.1; // Fallback thickness
      exitPoint = hitPoint
        .clone()
        .add(currentDir.clone().multiplyScalar(thickness));
    }

    // Calculate Physics Energy Loss
    let energyLoss = 0;

    if (enableEnergyLoss) {
      // Standard calculation
      energyLoss = props.density * thickness * 8;
    } else {
      // Infinite energy (negligible loss to allow math to proceed but effectively infinite)
      energyLoss = 0;
    }

    if (currentEnergy > energyLoss) {
      // PENETRATED
      currentEnergy -= energyLoss;

      const tumbleFactor = props.roughness * (thickness * 2); // Reduced tumble
      const newDir = getDeflection(currentDir, tumbleFactor);

      segments.push({
        start: hitPoint,
        end: exitPoint,
        direction: currentDir.clone(),
        type: "penetration",
        energyAtStart: currentEnergy,
      });

      currentPos = exitPoint.clone().add(newDir.multiplyScalar(PENETRATION_OFFSET));
      currentDir = newDir;
    } else {
      // STOPPED INSIDE
      segments.push({
        start: hitPoint,
        end: hitPoint
          .clone()
          .add(
            currentDir
              .clone()
              .multiplyScalar(thickness * (currentEnergy / energyLoss))
          ),
        direction: currentDir.clone(),
        type: "penetration",
        energyAtStart: 0,
      });
      currentEnergy = 0;
    }
  }

  return segments;
};




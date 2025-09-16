import type { Blueprint, JointInstance, PartInstance, Transform } from "./model";

export function cloneBlueprint<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function findPartInstance(
  blueprint: Blueprint,
  partInstanceId: string,
): PartInstance | undefined {
  return blueprint.root.parts.find((part) => part.id === partInstanceId);
}

export function updatePartTransform(
  blueprint: Blueprint,
  partInstanceId: string,
  transform: Transform,
): Blueprint {
  const next = cloneBlueprint(blueprint);
  const part = findPartInstance(next, partInstanceId);
  if (!part) {
    return blueprint;
  }
  part.transform = transform;
  return next;
}

export function findJointByTag(
  blueprint: Blueprint,
  tag: string,
): JointInstance | undefined {
  return blueprint.root.joints.find((joint) => joint.tags?.includes(tag));
}

export function partLabel(part: PartInstance, fallback?: string): string {
  if (part.label) return part.label;
  return fallback ?? part.id;
}

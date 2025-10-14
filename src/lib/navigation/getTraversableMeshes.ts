import * as THREE from 'three';
import { traversableQuery } from '../../store/ecs';

import { PositionMesh } from '@react-three/drei';

// Helper function to convert an InstancedMesh to a regular Mesh
// This creates a new mesh with the same geometry but applies all instance matrices
export const convertInstancedMeshToMesh = (instancedMesh: THREE.InstancedMesh): THREE.Mesh => {
  const geometry = instancedMesh.geometry.clone();
  const material =
    instancedMesh.material instanceof Array
      ? instancedMesh.material.map((m) => m.clone())
      : instancedMesh.material.clone();

  // Create a new BufferGeometry to hold all instances
  const combinedGeometry = new THREE.BufferGeometry();

  // Get position attribute from the original geometry
  const originalPositions = geometry.getAttribute('position');
  const count = originalPositions.count;

  // Create arrays to hold the combined geometry data
  const positions: number[] = [];
  const indices: number[] = [];

  // Get the index attribute if it exists
  const originalIndices = geometry.getIndex();

  // Process each instance
  const matrix = new THREE.Matrix4();
  const instanceCount = instancedMesh.count;

  for (let i = 0; i < instanceCount; i++) {
    // Get the transformation matrix for this instance
    instancedMesh.getMatrixAt(i, matrix);

    // Calculate the offset for indices in this instance
    const indexOffset = i * count;

    // Add transformed positions for this instance
    for (let j = 0; j < count; j++) {
      const x = originalPositions.getX(j);
      const y = originalPositions.getY(j);
      const z = originalPositions.getZ(j);

      // Create a vector, transform it by the instance matrix, and add to positions
      const vertex = new THREE.Vector3(x, y, z);
      vertex.applyMatrix4(matrix);

      positions.push(vertex.x, vertex.y, vertex.z);
    }

    // Add indices for this instance
    if (originalIndices) {
      for (let j = 0; j < originalIndices.count; j++) {
        indices.push(originalIndices.getX(j) + indexOffset);
      }
    } else {
      // If no indices, create them (assuming triangles)
      for (let j = 0; j < count; j++) {
        indices.push(j + indexOffset);
      }
    }
  }

  // Set the attributes on the combined geometry
  combinedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  combinedGeometry.setIndex(indices);

  // Create and return the combined mesh
  return new THREE.Mesh(combinedGeometry, material);
};

export const getTraversableMeshes = () => {
  const traversable = traversableQuery.entities.map((e) => e.three);

  const traversableMeshes = new Set<THREE.Mesh>();

  // console.log('traversable', traversable);

  for (const obj of traversable) {
    const meshes = getMeshesForObject(obj);
    // biome-ignore lint/complexity/noForEach: <explanation>
    meshes.forEach((mesh) => traversableMeshes.add(mesh));
  }

  return Array.from(traversableMeshes);
};

/**
 * Gets all meshes from a given Object3D, including handling special cases like PositionMesh
 * @param obj The Object3D to extract meshes from
 * @returns A Set of THREE.Mesh objects
 */
export const getMeshesForObject = (obj?: THREE.Object3D): Set<THREE.Mesh> => {
  const meshes = new Set<THREE.Mesh>();

  if (!obj) return meshes;

  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      meshes.add(child);
    } else if (child instanceof PositionMesh) {
      const instanceMesh: THREE.InstancedMesh | undefined = child.instance.current;
      if (instanceMesh) {
        // Convert the InstancedMesh to a regular Mesh with combined geometry
        const mesh = convertInstancedMeshToMesh(instanceMesh);
        meshes.add(mesh);
      }
    }
  });

  return meshes;
};

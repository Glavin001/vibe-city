import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { DebugDrawer } from '@recast-navigation/three';
import { useNavigation } from './useNavigation';
import { debounce } from 'lodash';

/**
 * Component to visualize the navigation mesh
 * This reads from the useNavigation store which should be populated by useRapierNavMesh
 */
export const NavMeshDebug = ({ enabled = true }: { enabled?: boolean }) => {
  const { dynamicTiledNavMesh } = useNavigation();
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    if (!dynamicTiledNavMesh || !enabled) return;

    const debugDrawer = new DebugDrawer();
    debugDrawer.drawNavMesh(dynamicTiledNavMesh.navMesh);
    scene.add(debugDrawer);

    // Create a debounced function that will only execute after 100ms of inactivity
    const debounceTime = 100;
    const debouncedUpdateDebugDrawer = debounce(() => {
      // console.log('NavMeshDebug debouncedUpdateDebugDrawer');
      // const startTime = performance.now();
      debugDrawer.reset();
      debugDrawer.drawNavMesh(dynamicTiledNavMesh.navMesh);
      // const endTime = performance.now();
      // console.log(`NavMesh debug drawing took ${endTime - startTime}ms`);
    }, debounceTime);

    const unsubOnNavMeshUpdate = dynamicTiledNavMesh.onNavMeshUpdate.add((version, tile) => {
      // console.log('NavMeshDebug onNavMeshUpdate', version, tile);
      debouncedUpdateDebugDrawer();
    });

    return () => {
      debouncedUpdateDebugDrawer.cancel(); // Cancel any pending debounced calls
      unsubOnNavMeshUpdate();
      scene.remove(debugDrawer);
      debugDrawer.dispose();
    };
  }, [dynamicTiledNavMesh, scene, enabled]);

  return null;
};

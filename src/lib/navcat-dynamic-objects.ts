import Rapier from '@dimforge/rapier3d-compat';
import { GUI } from 'lil-gui';
import { box3, triangle3, vec2, vec3 } from 'mathcat';
import type { Box3, Vec3 } from 'mathcat';
import {
    addOffMeshConnection,
    addTile,
    buildCompactHeightfield,
    BuildContext,
    buildContours,
    buildDistanceField,
    buildPolyMesh,
    buildPolyMeshDetail,
    buildRegions,
    buildTile,
    calculateGridSize,
    calculateMeshBounds,
    type CompactHeightfield,
    ContourBuildFlags,
    createFindNearestPolyResult,
    createHeightfield,
    createNavMesh,
    DEFAULT_QUERY_FILTER,
    erodeWalkableArea,
    filterLedgeSpans,
    filterLowHangingWalkableObstacles,
    filterWalkableLowHeightSpans,
    findNearestPoly,
    markCylinderArea,
    markWalkableTriangles,
    NULL_AREA,
    OffMeshConnectionDirection,
    type OffMeshConnectionParams,
    polyMeshDetailToTileDetailMesh,
    polyMeshToTilePolys,
    rasterizeTriangles,
    removeTile,
    WALKABLE_AREA,
} from 'navcat';
import {
    createNavMeshOffMeshConnectionsHelper,
    createNavMeshTileHelper,
    type DebugObject,
    getPositionsAndIndices,
} from 'navcat/three';
import { OrbitControls } from 'three/examples/jsm/Addons.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { Line2 } from 'three/examples/jsm/lines/webgpu/Line2.js';
import Stats from 'stats-gl';
import * as THREE from 'three/webgpu';
import { Line2NodeMaterial } from 'three/webgpu';
import { crowd, pathCorridor } from 'navcat/blocks';

type Cleanup = () => void;

type StaticObstacle = {
    position: Vec3;
    radius: number;
    height?: number;
};

type EnvironmentContext = {
    scene: THREE.Scene;
    renderer: THREE.WebGPURenderer;
    camera: THREE.PerspectiveCamera;
};

type EnvironmentResult = {
    walkableMeshes: THREE.Mesh[];
    navMeshGeometry?: {
        positions: Float32Array | number[];
        indices: Uint32Array | number[];
    };
    staticObstacles?: StaticObstacle[];
    setupPhysicsWorld?: (params: { physicsWorld: Rapier.World }) => void;
    cleanup?: () => void;
};

export type NavcatDynamicSceneOptions = {
    createEnvironment?: (context: EnvironmentContext) => Promise<EnvironmentResult> | EnvironmentResult;
    navMeshGeometry?: {
        positions: Float32Array | number[];
        indices: Uint32Array | number[];
    };
    initialCameraPosition?: Vec3;
    initialCameraTarget?: Vec3;
};

export type NavcatDynamicObjectsHandle = {
    dispose: () => void;
};

const loadGLTF = async (url: string) => {
    const loader = new GLTFLoader();
    return loader.loadAsync(url);
};

export async function createNavcatDynamicObjectsScene(
    container: HTMLElement,
    options: NavcatDynamicSceneOptions = {},
): Promise<NavcatDynamicObjectsHandle> {
    await Rapier.init();

    const randomRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const guiSettings = {
        showPathLine: false,
        pathCornerLimit: 3,
    };

    const gui = new GUI();
    gui.add(guiSettings, 'showPathLine').name('Show Path Line');
    gui.add(guiSettings, 'pathCornerLimit', 0, 32, 1).name('Path Corner Limit');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x202020);

    const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    const initialCameraPosition = options.initialCameraPosition ?? [-2, 10, 10];
    camera.position.set(initialCameraPosition[0], initialCameraPosition[1], initialCameraPosition[2]);

    const renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    const onWindowResize = () => {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', onWindowResize);

    await renderer.init();

    let stats: Stats | null = null;
    try {
        stats = new Stats({ trackGPU: true, logsPerSecond: 10 });
        await stats.init(renderer);
        const statsElement = stats.domElement;
        statsElement.style.position = 'absolute';
        statsElement.style.top = '1rem';
        statsElement.style.left = '1rem';
        statsElement.style.zIndex = '20';
        statsElement.style.pointerEvents = 'none';
        statsElement.classList.add('stats-gl-overlay');
        container.appendChild(statsElement);
    } catch (err) {
        console.warn('StatsGl initialization failed', err);
    }

    const orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    const initialCameraTarget = options.initialCameraTarget ?? [0, 0, 0];
    orbitControls.target.set(initialCameraTarget[0], initialCameraTarget[1], initialCameraTarget[2]);
    orbitControls.update();

    const createDefaultEnvironment = async (): Promise<EnvironmentResult> => {
        const levelModel = await loadGLTF('/models/nav-test.glb');
        scene.add(levelModel.scene);

        const walkableMeshes: THREE.Mesh[] = [];
        levelModel.scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
                walkableMeshes.push(object);
            }
        });

        const [positions, indices] = getPositionsAndIndices(walkableMeshes);

        return {
            walkableMeshes,
            navMeshGeometry: { positions, indices },
            setupPhysicsWorld: ({ physicsWorld }) => {
                const levelColliderDesc = Rapier.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices));
                levelColliderDesc.setMass(0);

                const levelRigidBodyDesc = Rapier.RigidBodyDesc.fixed();
                const levelRigidBody = physicsWorld.createRigidBody(levelRigidBodyDesc);

                physicsWorld.createCollider(levelColliderDesc, levelRigidBody);
            },
            cleanup: () => {
                scene.remove(levelModel.scene);
            },
        };
    };

    const environment = await (options.createEnvironment ?? createDefaultEnvironment)({
        scene,
        renderer,
        camera,
    });

    const walkableMeshes = environment.walkableMeshes;
    const staticObstacles = environment.staticObstacles ?? [];
    const setupPhysicsWorld = environment.setupPhysicsWorld;

    const navMeshGeometry = options.navMeshGeometry ?? environment.navMeshGeometry ?? (() => {
        const [positions, indices] = getPositionsAndIndices(walkableMeshes);
        return { positions, indices };
    })();

    const levelPositions =
        navMeshGeometry.positions instanceof Float32Array
            ? navMeshGeometry.positions
            : new Float32Array(navMeshGeometry.positions);

    const levelIndices =
        navMeshGeometry.indices instanceof Uint32Array
            ? navMeshGeometry.indices
            : new Uint32Array(navMeshGeometry.indices);

    const catModel = await loadGLTF('/models/cat.gltf');
    const catAnimations = catModel.animations;

    const cellSize = 0.15;
    const cellHeight = 0.15;
    const tileSizeVoxels = 32;
    const tileSizeWorld = tileSizeVoxels * cellSize;
    const walkableRadiusWorld = 0.15;
    const walkableRadiusVoxels = Math.ceil(walkableRadiusWorld / cellSize);
    const walkableClimbWorld = 0.5;
    const walkableClimbVoxels = Math.ceil(walkableClimbWorld / cellHeight);
    const walkableHeightWorld = 1;
    const walkableHeightVoxels = Math.ceil(walkableHeightWorld / cellHeight);
    const walkableSlopeAngleDegrees = 45;
    const borderSize = 4;
    const minRegionArea = 8;
    const mergeRegionArea = 20;
    const maxSimplificationError = 1.3;
    const maxEdgeLength = 12;
    const maxVerticesPerPoly = 5;
    const detailSampleDistanceVoxels = 6;
    const detailSampleDistance = detailSampleDistanceVoxels < 0.9 ? 0 : cellSize * detailSampleDistanceVoxels;
    const detailSampleMaxErrorVoxels = 1;
    const detailSampleMaxError = cellHeight * detailSampleMaxErrorVoxels;

    const meshBounds = calculateMeshBounds(box3.create(), levelPositions, levelIndices);
    const gridSize = calculateGridSize(vec2.create(), meshBounds, cellSize);

    const buildCtx = BuildContext.create();
    const navMesh = createNavMesh();
    navMesh.tileWidth = tileSizeWorld;
    navMesh.tileHeight = tileSizeWorld;
    navMesh.origin = meshBounds[0];

    const offMeshConnections: OffMeshConnectionParams[] = [
        {
            start: [0.39257542778564014, 3.9164539337158204, 2.7241512942770267],
            end: [1.2915380743929097, 2.8616158587143867, 3.398593875470379],
            direction: OffMeshConnectionDirection.START_TO_END,
            radius: 0.5,
            flags: 0xffffff,
            area: 0x000000,
        },
        {
            start: [3.491345350637368, 3.169861227710937, 2.8419154179454473],
            end: [4.0038066734125435, 0.466454005241394, 1.686211347289651],
            direction: OffMeshConnectionDirection.START_TO_END,
            radius: 0.5,
            flags: 0xffffff,
            area: 0x000000,
        },
        {
            start: [4.612475330561077, 0.466454005241394, 2.7619018768157435],
            end: [6.696740007427642, 0.5132029874438654, 2.5838885990777243],
            direction: OffMeshConnectionDirection.BIDIRECTIONAL,
            radius: 0.5,
            flags: 0xffffff,
            area: 0x000000,
        },
        {
            start: [3.8221359252929688, 0.47645399570465086, -4.391971844600165],
            end: [5.91173484469572, 0.6573111525835266, -4.671632275169128],
            direction: OffMeshConnectionDirection.BIDIRECTIONAL,
            radius: 0.5,
            flags: 0xffffff,
            area: 0x000000,
        },
        {
            start: [8.354324172733968, 0.5340897451517822, -3.2333049546492223],
            end: [8.461111697936666, 0.8365034207348984, -1.0863215738579806],
            direction: OffMeshConnectionDirection.START_TO_END,
            radius: 0.5,
            flags: 0xffffff,
            area: 0x000000,
        },
    ];

    for (const offMeshConnection of offMeshConnections) {
        addOffMeshConnection(navMesh, offMeshConnection);
    }

    const offMeshConnectionsHelper = createNavMeshOffMeshConnectionsHelper(navMesh);
    scene.add(offMeshConnectionsHelper.object);

    type PhysicsObj = {
        rigidBody: Rapier.RigidBody;
        mesh: THREE.Mesh;
        lastRespawn: number;
        lastPosition: Vec3;
        lastTiles: Set<string>;
        radius: number;
    };

    const physicsObjects: PhysicsObj[] = [];
    const tileToObjects = new Map<string, Set<number>>();

    const tileWidth = Math.floor((gridSize[0] + tileSizeVoxels - 1) / tileSizeVoxels);
    const tileHeight = Math.floor((gridSize[1] + tileSizeVoxels - 1) / tileSizeVoxels);

    const tileKey = (x: number, y: number) => `${x}_${y}`;

    const dirtyTiles = new Set<string>();
    const rebuildQueue: Array<[number, number]> = [];

    const tileHelpers = new Map<string, DebugObject>();
    const tileLastRebuilt = new Map<string, number>();
    type TileFlash = {
        startTime: number;
        duration: number;
    };
    const tileFlashes = new Map<string, TileFlash>();

    const TILE_REBUILD_THROTTLE_MS = 1000;

    const enqueueTile = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= tileWidth || y >= tileHeight) return;
        const key = tileKey(x, y);
        if (dirtyTiles.has(key)) return;
        dirtyTiles.add(key);
        rebuildQueue.push([x, y]);
    };

    for (let tx = 0; tx < tileWidth; tx++) {
        for (let ty = 0; ty < tileHeight; ty++) {
            enqueueTile(tx, ty);
        }
    }

    const getTileBounds = (x: number, y: number): Box3 => {
        const bounds = box3.create();
        const min: Vec3 = [meshBounds[0][0] + x * tileSizeWorld, meshBounds[0][1], meshBounds[0][2] + y * tileSizeWorld];
        const max: Vec3 = [meshBounds[0][0] + (x + 1) * tileSizeWorld, meshBounds[1][1], meshBounds[0][2] + (y + 1) * tileSizeWorld];
        box3.set(bounds, min, max);
        return bounds;
    };

    const tileCompactHFs = new Map<string, CompactHeightfield>();

    for (let tx = 0; tx < tileWidth; tx++) {
        for (let ty = 0; ty < tileHeight; ty++) {
            const tileBounds = getTileBounds(tx, ty);

            const expanded = box3.clone(tileBounds);
            expanded[0][0] -= borderSize * cellSize;
            expanded[0][2] -= borderSize * cellSize;
            expanded[1][0] += borderSize * cellSize;
            expanded[1][2] += borderSize * cellSize;

            const trianglesInBox: number[] = [];
            const triangle = triangle3.create();

            for (let i = 0; i < levelIndices.length; i += 3) {
                const a = levelIndices[i];
                const b = levelIndices[i + 1];
                const c = levelIndices[i + 2];

                vec3.fromBuffer(triangle[0], levelPositions, a * 3);
                vec3.fromBuffer(triangle[1], levelPositions, b * 3);
                vec3.fromBuffer(triangle[2], levelPositions, c * 3);

                if (box3.intersectsTriangle3(expanded, triangle)) {
                    trianglesInBox.push(a, b, c);
                }
            }

            const triAreaIds = new Uint8Array(trianglesInBox.length / 3).fill(0);
            markWalkableTriangles(levelPositions, trianglesInBox, triAreaIds, walkableSlopeAngleDegrees);

            const hfW = Math.floor(tileSizeVoxels + borderSize * 2);
            const hfH = Math.floor(tileSizeVoxels + borderSize * 2);
            const heightfield = createHeightfield(hfW, hfH, expanded, cellSize, cellHeight);

            rasterizeTriangles(buildCtx, heightfield, levelPositions, trianglesInBox, triAreaIds, walkableClimbVoxels);

            filterLowHangingWalkableObstacles(heightfield, walkableClimbVoxels);
            filterLedgeSpans(heightfield, walkableHeightVoxels, walkableClimbVoxels);
            filterWalkableLowHeightSpans(heightfield, walkableHeightVoxels);

            const compactHeightfield = buildCompactHeightfield(buildCtx, walkableHeightVoxels, walkableClimbVoxels, heightfield);
            erodeWalkableArea(walkableRadiusVoxels, compactHeightfield);
            buildDistanceField(compactHeightfield);

            tileCompactHFs.set(tileKey(tx, ty), compactHeightfield);
        }
    }

    const processRebuildQueue = (maxPerFrame: number) => {
        let processed = 0;

        for (let i = 0; i < rebuildQueue.length; i++) {
            if (processed >= maxPerFrame) break;

            const tile = rebuildQueue.shift();
            if (!tile) return;
            const [tx, ty] = tile;
            const key = tileKey(tx, ty);

            const last = tileLastRebuilt.get(key) ?? 0;
            const now = performance.now();
            if (now - last < TILE_REBUILD_THROTTLE_MS) {
                rebuildQueue.push([tx, ty]);
                continue;
            }

            dirtyTiles.delete(key);

            const tileBounds = getTileBounds(tx, ty);

            try {
                const precomputedCompactHeightfield = tileCompactHFs.get(key);

                if (!precomputedCompactHeightfield) {
                    console.error('No precomputed compact heightfield for tile', key);
                    continue;
                }

                const chf = structuredClone(precomputedCompactHeightfield);

                const influencing = tileToObjects.get(key);

                if (influencing && influencing.size > 0) {
                    for (const objIndex of influencing) {
                        const obj = physicsObjects[objIndex];
                        if (!obj) continue;

                        const pos = obj.mesh.position;
                        const worldRadius = obj.radius;

                        const min = tileBounds[0];
                        const max = tileBounds[1];
                        if (
                            pos.x + worldRadius < min[0] ||
                            pos.x - worldRadius > max[0] ||
                            pos.y + worldRadius < min[1] ||
                            pos.y - worldRadius > max[1] ||
                            pos.z + worldRadius < min[2] ||
                            pos.z - worldRadius > max[2]
                        ) {
                            continue;
                        }

                        markCylinderArea([pos.x, pos.y - worldRadius, pos.z], worldRadius, worldRadius, NULL_AREA, chf);
                    }
                } else {
                    for (const obj of physicsObjects) {
                        const pos = obj.mesh.position;
                        const worldRadius = obj.radius ?? 0.5;
                        const min = tileBounds[0];
                        const max = tileBounds[1];
                        if (
                            pos.x + worldRadius < min[0] ||
                            pos.x - worldRadius > max[0] ||
                            pos.y + worldRadius < min[1] ||
                            pos.y - worldRadius > max[1] ||
                            pos.z + worldRadius < min[2] ||
                            pos.z - worldRadius > max[2]
                        ) {
                            continue;
                        }
                        markCylinderArea([pos.x, pos.y - worldRadius, pos.z], worldRadius, worldRadius, NULL_AREA, chf);
                    }
                }

                if (staticObstacles.length > 0) {
                    for (const obstacle of staticObstacles) {
                        const [ox, oy, oz] = obstacle.position;
                        const radius = obstacle.radius;
                        const height = obstacle.height ?? radius;
                        markCylinderArea([ox, oy, oz], radius, height, NULL_AREA, chf);
                    }
                }

                buildRegions(buildCtx, chf, borderSize, minRegionArea, mergeRegionArea);

                const contourSet = buildContours(
                    buildCtx,
                    chf,
                    maxSimplificationError,
                    maxEdgeLength,
                    ContourBuildFlags.CONTOUR_TESS_WALL_EDGES,
                );

                const polyMesh = buildPolyMesh(buildCtx, contourSet, maxVerticesPerPoly);

                for (let polyIndex = 0; polyIndex < polyMesh.nPolys; polyIndex++) {
                    if (polyMesh.areas[polyIndex] === WALKABLE_AREA) {
                        polyMesh.areas[polyIndex] = 0;
                    }

                    if (polyMesh.areas[polyIndex] === 0) {
                        polyMesh.flags[polyIndex] = 1;
                    }
                }

                const polyMeshDetail = buildPolyMeshDetail(buildCtx, polyMesh, chf, detailSampleDistance, detailSampleMaxError);

                const tilePolys = polyMeshToTilePolys(polyMesh);
                const tileDetail = polyMeshDetailToTileDetailMesh(tilePolys.polys, polyMeshDetail);

            const tileParams: Parameters<typeof buildTile>[0] = {
                    bounds: polyMesh.bounds,
                    vertices: tilePolys.vertices,
                    polys: tilePolys.polys,
                    detailMeshes: tileDetail.detailMeshes,
                    detailVertices: tileDetail.detailVertices,
                    detailTriangles: tileDetail.detailTriangles,
                    tileX: tx,
                    tileY: ty,
                    tileLayer: 0,
                    cellSize,
                    cellHeight,
                    walkableHeight: walkableHeightWorld,
                    walkableRadius: walkableRadiusWorld,
                    walkableClimb: walkableClimbWorld,
            };

                const tile = buildTile(tileParams);

                removeTile(navMesh, tx, ty, 0);
                addTile(navMesh, tile);

                const tileKeyStr = tileKey(tx, ty);
                const oldTileHelper = tileHelpers.get(tileKeyStr);
                if (oldTileHelper) {
                    scene.remove(oldTileHelper.object);
                    oldTileHelper.dispose();
                    tileHelpers.delete(tileKeyStr);
                }

                for (const tileId in navMesh.tiles) {
                    const t = navMesh.tiles[tileId];
                    if (t.tileX === tx && t.tileY === ty) {
                        const newTileHelper = createNavMeshTileHelper(t);
                        newTileHelper.object.position.y += 0.05;
                        scene.add(newTileHelper.object);
                        tileHelpers.set(tileKeyStr, newTileHelper);

                        tileFlashes.set(tileKeyStr, {
                            startTime: performance.now(),
                            duration: 1500,
                        });

                        break;
                    }
                }

                tileLastRebuilt.set(key, performance.now());

                processed++;
            } catch (err) {
                console.error('Tile build failed', err);
                processed++;
            }
        }
    };

    const buildAllTiles = () => {
        while (rebuildQueue.length > 0) {
            processRebuildQueue(64);
        }
    };

    const tilesForAABB = (min: Vec3, max: Vec3) => {
        const minX = Math.floor((min[0] - meshBounds[0][0]) / tileSizeWorld);
        const minY = Math.floor((min[2] - meshBounds[0][2]) / tileSizeWorld);
        const maxX = Math.floor((max[0] - meshBounds[0][0]) / tileSizeWorld);
        const maxY = Math.floor((max[2] - meshBounds[0][2]) / tileSizeWorld);

        const out: Array<[number, number]> = [];
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                out.push([x, y]);
            }
        }
        return out;
    };

    const updateObjectTiles = (objIndex: number, newTiles: Set<string>) => {
        const obj = physicsObjects[objIndex];
        if (!obj) return;

        for (const oldKey of obj.lastTiles) {
            if (!newTiles.has(oldKey)) {
                const s = tileToObjects.get(oldKey);
                if (s) {
                    s.delete(objIndex);
                    if (s.size === 0) tileToObjects.delete(oldKey);
                }
            }
        }

        for (const newKey of newTiles) {
            if (!obj.lastTiles.has(newKey)) {
                let s = tileToObjects.get(newKey);
                if (!s) {
                    s = new Set<number>();
                    tileToObjects.set(newKey, s);
                }
                s.add(objIndex);
            }
        }

        obj.lastTiles = newTiles;
    };

    buildAllTiles();

    const physicsWorld = new Rapier.World(new Rapier.Vector3(0, -9.81, 0));

    if (setupPhysicsWorld) {
        setupPhysicsWorld({ physicsWorld });
    } else {
        const levelColliderDesc = Rapier.ColliderDesc.trimesh(new Float32Array(levelPositions), new Uint32Array(levelIndices));
        levelColliderDesc.setMass(0);

        const levelRigidBodyDesc = Rapier.RigidBodyDesc.fixed();
        const levelRigidBody = physicsWorld.createRigidBody(levelRigidBodyDesc);

        physicsWorld.createCollider(levelColliderDesc, levelRigidBody);
    }

    const obstacleCount = 60;

    const spawnObstacle = () => {
        const shapeRoll = Math.random();
        const color = new THREE.Color().setHSL(Math.random(), 0.6, 0.55);

        let geometry: THREE.BufferGeometry;
        let colliderDesc: Rapier.ColliderDesc;

        if (shapeRoll < 0.33) {
            const width = randomRange(0.4, 1.4);
            const height = randomRange(0.4, 1.2);
            const depth = randomRange(0.4, 1.4);
            geometry = new THREE.BoxGeometry(width, height, depth);
            colliderDesc = Rapier.ColliderDesc.cuboid(width / 2, height / 2, depth / 2);
        } else if (shapeRoll < 0.66) {
            const radius = randomRange(0.25, 0.75);
            geometry = new THREE.SphereGeometry(radius, 24, 18);
            colliderDesc = Rapier.ColliderDesc.ball(radius);
        } else {
            const radius = randomRange(0.25, 0.65);
            const height = randomRange(0.6, 1.6);
            geometry = new THREE.CylinderGeometry(radius, radius, height, 24);
            colliderDesc = Rapier.ColliderDesc.cylinder(height / 2, radius);
        }

        colliderDesc.setRestitution(randomRange(0.02, 0.08));
        colliderDesc.setFriction(0.6);
        colliderDesc.setDensity(1.0);

        const material = new THREE.MeshStandardMaterial({ color: color.getHex() });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        scene.add(mesh);

        const spawnX = (Math.random() - 0.5) * 16;
        const spawnZ = (Math.random() - 0.5) * 16;
        const spawnY = randomRange(12, 24);

        const rigidBodyDesc = Rapier.RigidBodyDesc.dynamic()
            .setTranslation(spawnX, spawnY, spawnZ)
            .setLinearDamping(0.75)
            .setAngularDamping(0.6)
            .setAngvel({ x: (Math.random() - 0.5) * 0.8, y: (Math.random() - 0.5) * 0.8, z: (Math.random() - 0.5) * 0.8 });

        const rigidBody = physicsWorld.createRigidBody(rigidBodyDesc);
        physicsWorld.createCollider(colliderDesc, rigidBody);
        rigidBody.setLinearDamping(0.75);
        rigidBody.setAngularDamping(0.6);

        if (!geometry.boundingSphere) {
            geometry.computeBoundingSphere();
        }
        const boundingSphereRadius = geometry.boundingSphere?.radius ?? 0.5;
        const worldRadius = boundingSphereRadius;

        const translation = rigidBody.translation();
        mesh.position.set(translation.x, translation.y, translation.z);

        const physicsObject: PhysicsObj = {
            rigidBody,
            mesh,
            lastRespawn: performance.now(),
            lastPosition: [translation.x, translation.y, translation.z],
            lastTiles: new Set<string>(),
            radius: worldRadius,
        };

        physicsObjects.push(physicsObject);
        const objIndex = physicsObjects.length - 1;

        const min: Vec3 = [translation.x - worldRadius, translation.y - worldRadius, translation.z - worldRadius];
        const max: Vec3 = [translation.x + worldRadius, translation.y + worldRadius, translation.z + worldRadius];
        const tiles = tilesForAABB(min, max);
        const tilesSet = new Set<string>();
        for (const [tx, ty] of tiles) {
            const key = tileKey(tx, ty);
            tilesSet.add(key);
            let set = tileToObjects.get(key);
            if (!set) {
                set = new Set<number>();
                tileToObjects.set(key, set);
            }
            set.add(objIndex);
        }

        physicsObject.lastTiles = tilesSet;
    };

    for (let i = 0; i < obstacleCount; i++) {
        spawnObstacle();
    }

    type AgentVisuals = {
        group: THREE.Group;
        mixer: THREE.AnimationMixer;
        idleAction: THREE.AnimationAction;
        walkAction: THREE.AnimationAction;
        runAction: THREE.AnimationAction;
        currentAnimation: 'idle' | 'walk' | 'run';
        currentRotation: number;
        targetRotation: number;
        color: number;
        targetMesh: THREE.Mesh;
    pathLine: Line2 | null;
    pathGeometry: LineGeometry | null;
    pathMaterial: Line2NodeMaterial | null;
    };

    type AgentVisualsOptions = {
        showPathLine?: boolean;
        pathCornerLimit?: number;
    };

    const cloneCatModel = (color?: number): THREE.Group => {
        const clone = catModel.scene.clone(true);

        const patchMaterial = (material: THREE.Material): THREE.Material => {
            if (
                color !== undefined &&
                (material instanceof THREE.MeshLambertMaterial ||
                    material instanceof THREE.MeshStandardMaterial ||
                    material instanceof THREE.MeshPhongMaterial)
            ) {
                const clonedMat = material.clone();

                clonedMat.color.setHex(color);
                clonedMat.color.multiplyScalar(2);

                if (clonedMat instanceof THREE.MeshStandardMaterial) {
                    clonedMat.emissive.setHex(color);
                    clonedMat.emissiveIntensity = 0.1;
                    clonedMat.roughness = 0.3;
                    clonedMat.metalness = 0.1;
                }

                return clonedMat;
            }

            return material;
        };

        const skinnedMeshes: THREE.SkinnedMesh[] = [];

        clone.traverse((child) => {
            if (child instanceof THREE.SkinnedMesh) {
                skinnedMeshes.push(child);
            }

            if (child instanceof THREE.Mesh) {
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(patchMaterial);
                } else {
                    child.material = patchMaterial(child.material);
                }
            }
        });

        for (const skinnedMesh of skinnedMeshes) {
            const skeleton = skinnedMesh.skeleton;
            const bones: THREE.Bone[] = [];

            for (const bone of skeleton.bones) {
                const foundBone = clone.getObjectByName(bone.name);
                if (foundBone instanceof THREE.Bone) {
                    bones.push(foundBone);
                }
            }

            skinnedMesh.bind(new THREE.Skeleton(bones, skeleton.boneInverses));
        }

        return clone;
    };

    const createAgentVisuals = (position: Vec3, color: number, radius: number): AgentVisuals => {
        const catGroup = cloneCatModel(color);
        catGroup.position.set(position[0], position[1], position[2]);
        catGroup.scale.setScalar(radius * 1.5);
        scene.add(catGroup);

        const mixer = new THREE.AnimationMixer(catGroup);

        const idleClip = catAnimations.find((clip) => clip.name === 'Idle');
        const walkClip = catAnimations.find((clip) => clip.name === 'Walk');
        const runClip = catAnimations.find((clip) => clip.name === 'Run');

        if (!idleClip || !walkClip || !runClip) {
            throw new Error('Missing required animations in cat model');
        }

        const idleAction = mixer.clipAction(idleClip);
        const walkAction = mixer.clipAction(walkClip);
        const runAction = mixer.clipAction(runClip);

        idleAction.loop = THREE.LoopRepeat;
        walkAction.loop = THREE.LoopRepeat;
        runAction.loop = THREE.LoopRepeat;

        idleAction.play();

        const targetGeometry = new THREE.SphereGeometry(0.1);
        const targetMaterial = new THREE.MeshBasicMaterial({ color });
        const targetMesh = new THREE.Mesh(targetGeometry, targetMaterial);
        scene.add(targetMesh);

        return {
            group: catGroup,
            mixer,
            idleAction,
            walkAction,
            runAction,
            currentAnimation: 'idle',
            currentRotation: 0,
            targetRotation: 0,
            color,
            targetMesh,
        pathLine: null,
        pathGeometry: null,
        pathMaterial: null,
        };
    };

    const updateAgentVisuals = (
        agent: crowd.Agent,
        visuals: AgentVisuals,
        deltaTime: number,
        options: AgentVisualsOptions = {},
    ): void => {
        visuals.mixer.update(deltaTime);

        visuals.group.position.fromArray(agent.position);

        const velocity = vec3.length(agent.velocity);
        let targetAnimation: 'idle' | 'walk' | 'run' = 'idle';

        if (velocity > 2.5) {
            targetAnimation = 'run';
        } else if (velocity > 0.1) {
            targetAnimation = 'walk';
        }

        if (visuals.currentAnimation !== targetAnimation) {
            const currentAction =
                visuals.currentAnimation === 'idle'
                    ? visuals.idleAction
                    : visuals.currentAnimation === 'walk'
                      ? visuals.walkAction
                      : visuals.runAction;

            const targetAction =
                targetAnimation === 'idle' ? visuals.idleAction : targetAnimation === 'walk' ? visuals.walkAction : visuals.runAction;

            currentAction.fadeOut(0.3);
            targetAction.reset().fadeIn(0.3).play();

            visuals.currentAnimation = targetAnimation;
        }

        const minVelocityThreshold = 0.1;
        const rotationLerpSpeed = 5.0;

        if (velocity > minVelocityThreshold) {
            const direction = vec3.normalize([0, 0, 0], agent.velocity);
            const targetAngle = Math.atan2(direction[0], direction[2]);
            visuals.targetRotation = targetAngle;
        } else {
            const targetDirection = vec3.subtract([0, 0, 0], agent.targetPosition, agent.position);
            const targetDistance = vec3.length(targetDirection);

            if (targetDistance > 0.1) {
                const normalizedTarget = vec3.normalize([0, 0, 0], targetDirection);
                const targetAngle = Math.atan2(normalizedTarget[0], normalizedTarget[2]);
                visuals.targetRotation = targetAngle;
            }
        }

        let angleDiff = visuals.targetRotation - visuals.currentRotation;

        if (angleDiff > Math.PI) {
            angleDiff -= 2 * Math.PI;
        } else if (angleDiff < -Math.PI) {
            angleDiff += 2 * Math.PI;
        }

        visuals.currentRotation += angleDiff * rotationLerpSpeed * deltaTime;
        visuals.group.rotation.y = visuals.currentRotation;

        visuals.targetMesh.position.fromArray(agent.targetPosition);
        visuals.targetMesh.position.y += 0.1;

        if (options.showPathLine) {
            const cornerLimit = options.pathCornerLimit ?? 3;
            const effectiveLimit = cornerLimit && cornerLimit > 0 ? cornerLimit : 128;
            const corners = pathCorridor.findCorners(agent.corridor, navMesh, effectiveLimit);
        const positions: number[] = [];

        const pushPoint = (x: number, y: number, z: number) => {
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                positions.push(x, y + 0.2, z);
            }
        };

        pushPoint(agent.position[0], agent.position[1], agent.position[2]);

        if (corners && corners.length > 0) {
            for (const corner of corners) {
                pushPoint(corner.position[0], corner.position[1], corner.position[2]);
            }
        }

        if (positions.length >= 6) {
            if (!visuals.pathLine || !visuals.pathGeometry || !visuals.pathMaterial) {
                const geometry = new LineGeometry();
                geometry.setPositions(positions);
                const material = new Line2NodeMaterial({ color: visuals.color, linewidth: 0.12, worldUnits: true });
                const line = new Line2(geometry, material);
                visuals.pathGeometry = geometry;
                visuals.pathMaterial = material;
                visuals.pathLine = line;
                line.computeLineDistances();
                scene.add(line);
            } else {
            visuals.pathGeometry.setPositions(positions);
            visuals.pathLine.visible = true;
            visuals.pathLine.computeLineDistances();
            }
        } else if (visuals.pathLine) {
            visuals.pathLine.visible = false;
        }
        } else if (visuals.pathLine) {
            visuals.pathLine.visible = false;
        }
    };

    const catsCrowd = crowd.create(1);

    const agentParams: crowd.AgentParams = {
        radius: 0.3,
        height: 0.6,
        maxAcceleration: 15.0,
        maxSpeed: 3.5,
        collisionQueryRange: 2,
        separationWeight: 0.5,
        updateFlags:
            crowd.CrowdUpdateFlags.ANTICIPATE_TURNS |
            crowd.CrowdUpdateFlags.SEPARATION |
            crowd.CrowdUpdateFlags.OBSTACLE_AVOIDANCE |
            crowd.CrowdUpdateFlags.OPTIMIZE_TOPO |
            crowd.CrowdUpdateFlags.OPTIMIZE_VIS,
        queryFilter: DEFAULT_QUERY_FILTER,
        autoTraverseOffMeshConnections: true,
        obstacleAvoidance: crowd.DEFAULT_OBSTACLE_AVOIDANCE_PARAMS,
    };

    const agentPositions: Vec3[] = Array.from({ length: 2 }).map((_, i) => [-2 + i * -0.05, 0.5, 3]) as Vec3[];

    const agentColors = [0x0000ff, 0x00ff00];

    const agentVisuals: Record<string, AgentVisuals> = {};

    for (let i = 0; i < agentPositions.length; i++) {
        const position = agentPositions[i];
        const color = agentColors[i % agentColors.length];

        const agentId = crowd.addAgent(catsCrowd, navMesh, position, agentParams);
        agentVisuals[agentId] = createAgentVisuals(position, color, agentParams.radius);
    }

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onPointerDown = (event: MouseEvent) => {
        if (event.button !== 0) return;

        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);

        const intersects = raycaster.intersectObjects(walkableMeshes, true);

        if (intersects.length === 0) return;

        const intersectionPoint = intersects[0].point;
        const targetPosition: Vec3 = [intersectionPoint.x, intersectionPoint.y, intersectionPoint.z];

        const halfExtents: Vec3 = [1, 1, 1];
        const nearestResult = findNearestPoly(
            createFindNearestPolyResult(),
            navMesh,
            targetPosition,
            halfExtents,
            DEFAULT_QUERY_FILTER,
        );

        if (!nearestResult.success) return;

        for (const agentId in catsCrowd.agents) {
            crowd.requestMoveTarget(catsCrowd, agentId, nearestResult.nodeRef, nearestResult.position);
        }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    let prevTime = performance.now();
    let rafId = 0;
    let disposed = false;

    const update = () => {
        if (disposed) return;
        rafId = requestAnimationFrame(update);

        const time = performance.now();
        const deltaTime = (time - prevTime) / 1000;
        const clampedDeltaTime = Math.min(deltaTime, 0.1);
        prevTime = time;

        crowd.update(catsCrowd, navMesh, clampedDeltaTime);

        physicsWorld.timestep = clampedDeltaTime;
        physicsWorld.step();

        for (const obj of physicsObjects) {
            const position = obj.rigidBody.translation();
            const rotation = obj.rigidBody.rotation();

            obj.mesh.position.set(position.x, position.y, position.z);
            obj.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        }

        const RESPAWN_INTERVAL_MS = 10000;
        for (const obj of physicsObjects) {
            const position = obj.rigidBody.translation();
            const nowMs = performance.now();

            const fellOut = position.y < -10;
            const periodic = nowMs - (obj.lastRespawn ?? 0) >= RESPAWN_INTERVAL_MS;

        if (fellOut || periodic) {
            const x = (Math.random() - 0.5) * 16;
            const y = randomRange(12, 24);
            const z = (Math.random() - 0.5) * 16;

                obj.rigidBody.setTranslation({ x, y, z }, true);
                obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
            obj.mesh.position.set(x, y, z);

                const r = obj.radius ?? 0.5;
                const min: Vec3 = [x - r, y - r, z - r];
                const max: Vec3 = [x + r, y + r, z + r];
                const tiles = tilesForAABB(min, max);
                const newTiles = new Set<string>();
                for (const [tx, ty] of tiles) {
                    newTiles.add(tileKey(tx, ty));
                }

                const idx = physicsObjects.indexOf(obj);
                if (idx !== -1) {
                    updateObjectTiles(idx, newTiles);
                }

                obj.lastPosition[0] = x;
                obj.lastPosition[1] = y;
                obj.lastPosition[2] = z;
                obj.lastRespawn = nowMs;
            }
        }

        for (let i = 0; i < physicsObjects.length; i++) {
            const obj = physicsObjects[i];
            const posNow = obj.rigidBody.translation();
            const curPos: Vec3 = [posNow.x, posNow.y, posNow.z];

            const r = obj.radius;
            const min: Vec3 = [
                Math.min(obj.lastPosition[0], curPos[0]) - r,
                Math.min(obj.lastPosition[1], curPos[1]) - r,
                Math.min(obj.lastPosition[2], curPos[2]) - r,
            ];
            const max: Vec3 = [
                Math.max(obj.lastPosition[0], curPos[0]) + r,
                Math.max(obj.lastPosition[1], curPos[1]) + r,
                Math.max(obj.lastPosition[2], curPos[2]) + r,
            ];

            const tiles = tilesForAABB(min, max);
            const newTiles = new Set<string>();
            for (const [tx, ty] of tiles) {
                newTiles.add(tileKey(tx, ty));
            }

            const isSleeping = obj.rigidBody.isSleeping();

            for (const oldKey of obj.lastTiles) {
                if (!newTiles.has(oldKey)) {
                    const parts = oldKey.split('_');
                    const tx = parseInt(parts[0], 10);
                    const ty = parseInt(parts[1], 10);
                    enqueueTile(tx, ty);
                }
            }

            if (!isSleeping) {
                for (const newKey of newTiles) {
                    const parts = newKey.split('_');
                    const tx = parseInt(parts[0], 10);
                    const ty = parseInt(parts[1], 10);
                    enqueueTile(tx, ty);
                }
            }

            updateObjectTiles(i, newTiles);

            obj.lastPosition = curPos;
        }

        processRebuildQueue(1);

        const now = performance.now();
        const flashesToRemove: string[] = [];

        for (const [tileKeyStr, flash] of tileFlashes) {
            const elapsed = now - flash.startTime;
            const t = Math.min(elapsed / flash.duration, 1.0);

            const tileHelper = tileHelpers.get(tileKeyStr);
            if (tileHelper) {
                const fadeAmount = (1.0 - t) ** 3;

                tileHelper.object.traverse((child) => {
                    if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
                        const material = child.material as THREE.MeshBasicMaterial;

                        const baseColor = 0x222222;
                        const flashColor = 0x005500;

                        const baseR = (baseColor >> 16) & 0xff;
                        const baseG = (baseColor >> 8) & 0xff;
                        const baseB = baseColor & 0xff;

                        const flashR = (flashColor >> 16) & 0xff;
                        const flashG = (flashColor >> 8) & 0xff;
                        const flashB = flashColor & 0xff;

                        const r = Math.round(flashR * fadeAmount + baseR * (1 - fadeAmount));
                        const g = Math.round(flashG * fadeAmount + baseG * (1 - fadeAmount));
                        const b = Math.round(flashB * fadeAmount + baseB * (1 - fadeAmount));

                        const color = (r << 16) | (g << 8) | b;
                        material.color.setHex(color);
                        material.vertexColors = false;
                    }
                });
            }

            if (t >= 1.0) {
                flashesToRemove.push(tileKeyStr);
            }
        }

        for (const key of flashesToRemove) {
            tileFlashes.delete(key);
        }

        const agents = Object.keys(catsCrowd.agents);

        for (let i = 0; i < agents.length; i++) {
            const agentId = agents[i];
            const agent = catsCrowd.agents[agentId];

            if (agentVisuals[agentId]) {
                updateAgentVisuals(agent, agentVisuals[agentId], clampedDeltaTime, {
                    showPathLine: guiSettings.showPathLine,
                    pathCornerLimit: guiSettings.pathCornerLimit,
                });
            }
        }

        orbitControls.update(clampedDeltaTime);

        renderer.render(scene, camera);
        stats?.update();
    };

    update();

    const cleanupTasks: Cleanup[] = [
        () => {
            disposed = true;
            cancelAnimationFrame(rafId);
        },
        () => window.removeEventListener('resize', onWindowResize),
        () => renderer.domElement.removeEventListener('pointerdown', onPointerDown),
        () => {
            orbitControls.dispose();
        },
        () => {
            gui.destroy();
        },
        () => {
            if (renderer.domElement.parentElement === container) {
                container.removeChild(renderer.domElement);
            }
            renderer.dispose();
        },
        () => {
            for (const helper of tileHelpers.values()) {
                scene.remove(helper.object);
                helper.dispose();
            }
            tileHelpers.clear();
        },
        () => {
            scene.remove(offMeshConnectionsHelper.object);
            offMeshConnectionsHelper.dispose();
        },
        () => {
            if (stats) {
                stats.domElement.remove();
                stats = null;
            }
        },
        () => {
            for (const obj of physicsObjects) {
                scene.remove(obj.mesh);
            }
            physicsObjects.length = 0;
        },
        () => {
            environment.cleanup?.();
        },
        () => {
            for (const agentId in agentVisuals) {
                const visuals = agentVisuals[agentId];
                scene.remove(visuals.group);
                scene.remove(visuals.targetMesh);
                if (visuals.pathLine) {
                    scene.remove(visuals.pathLine);
                    visuals.pathGeometry?.dispose();
                    visuals.pathMaterial?.dispose();
                }
                visuals.idleAction.stop();
                visuals.walkAction.stop();
                visuals.runAction.stop();
            }
        },
        () => {
            physicsWorld.free();
        },
    ];

    return {
        dispose: () => {
            for (const task of cleanupTasks) {
                try {
                    task();
                } catch (err) {
                    console.error('Cleanup failed', err);
                }
            }
        },
    };
}



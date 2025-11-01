"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { TilesRenderer } from "3d-tiles-renderer";
import RAPIER from "@dimforge/rapier3d-compat";
import * as Cesium from "cesium";

export default function Map3DPage() {
  const cesiumIonToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || "";
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let rafId: number | null = null;
    let cleanupFns: Array<() => void> = [];
    let destroyed = false;
    const log = (...args: any[]) => console.log("[map-3d]", ...args);
    const warn = (...args: any[]) => console.warn("[map-3d]", ...args);
    const err = (...args: any[]) => console.error("[map-3d]", ...args);

    // Early guard: require Cesium Ion token for asset/terrain APIs
    if (!cesiumIonToken) {
      const message = "Cesium Ion token is missing. Set NEXT_PUBLIC_CESIUM_ION_TOKEN in .env.local and restart the dev server.";
      const logEl = document.getElementById("log") as HTMLDivElement | null;
      if (logEl) logEl.textContent = message;
      err(message);
      throw new Error(message);
    }

    const run = async () => {
      log("boot: starting initialization");
      if (typeof (RAPIER as typeof import("@dimforge/rapier3d-compat"))?.init === "function") {
        log("rapier: init()...");
        await (RAPIER as typeof import("@dimforge/rapier3d-compat")).init();
        log("rapier: initialized");
      } else {
        warn("rapier: no init() function detected");
      }
      try {
        Cesium.Ion.defaultAccessToken = cesiumIonToken;
        // Cap concurrent requests to avoid resource exhaustion during bootstrap
        Cesium.RequestScheduler.maximumRequestsPerServer = 6;
        Cesium.RequestScheduler.maximumRequests = 20;
        log("cesium: Ion token set (length)", cesiumIonToken.length);
        log("cesium: request caps", { perServer: Cesium.RequestScheduler.maximumRequestsPerServer, maxTotal: Cesium.RequestScheduler.maximumRequests });
      } catch (e) {
        err("cesium: failed to set Ion token", e);
      }
      const canvas = canvasRef.current as HTMLCanvasElement | null;
      const logEl = document.getElementById("log") as HTMLDivElement | null;
      if (!canvas || destroyed) {
        log("canvas not found or destroyed");
        return;
      }

      // --- Scene setup ---
      log("three: creating scene/renderer/camera");
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b0e12);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2e7);
      camera.position.set(0, 40, 80);
      log("three: renderer/camera ready", { size: [window.innerWidth, window.innerHeight] });

      const hemi = new THREE.HemisphereLight(0xffffff, 0x0b0e12, 0.75);
      const dir = new THREE.DirectionalLight(0xffffff, 1.2);
      dir.position.set(200, 500, 200);
      scene.add(hemi, dir);

      // Add a basic green ground plane for immediate visual feedback
      const groundGeometry = new THREE.PlaneGeometry(1000, 1000);
      const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x4a7c59 });
      const ground = new THREE.Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
      ground.receiveShadow = true;
      scene.add(ground);

      const tilesRenderers: any[] = [];
      const physicsForTileScene = new WeakMap<any, { bodies: any[]; colliders: any[] }>();

      const matBuildings = new THREE.MeshStandardMaterial({ color: 0x7890b5, metalness: 0.1, roughness: 0.85 });
      const matRoads = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.0, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const matTerrain = new THREE.MeshStandardMaterial({ color: 0x6e7f4f, metalness: 0.0, roughness: 0.95 });
      const matTrees = new THREE.MeshStandardMaterial({ color: 0x2faa45, metalness: 0.0, roughness: 0.95 });

      let ecefToLocal_THREE = new THREE.Matrix4();
      let localToEcef_CESIUM: any = null;
      let world: any = null;

      const onResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        tilesRenderers.forEach((tr) => tr.setResolutionFromRenderer(camera, renderer));
      };
      window.addEventListener("resize", onResize);
      cleanupFns.push(() => window.removeEventListener("resize", onResize));

      async function makeTilesRendererFromIonAsset(assetId: number, { onModel }: { onModel?: (tileScene: any) => void; }) {
        const u = new URL("https://api.cesium.com/v1/assets/" + assetId + "/endpoint");
        u.searchParams.set("access_token", cesiumIonToken);
        log("cesium: fetching endpoint", { assetId, url: u.toString() });
        const res = await fetch(u, { mode: "cors" });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          err("cesium: endpoint fetch failed", { status: res.status, body: text });
          throw new Error("Cesium endpoint fetch failed: status " + res.status);
        }
        const endpoint = await res.json().catch((e) => {
          err("cesium: endpoint JSON parse failed", e);
          throw e;
        });
        log("cesium: endpoint ok", { hasAccessToken: !!endpoint?.accessToken, url: endpoint?.url });
        const url = new URL(endpoint.url);
        const version = url.searchParams.get("v");
        const tr = new TilesRenderer(url.toString());
        tr.setCamera(camera);
        tr.setResolutionFromRenderer(camera, renderer);
        tr.fetchOptions.headers = { Authorization: "Bearer " + endpoint.accessToken };
        tr.preprocessURL = (uri: string) => {
          const _u = new URL(uri, location.href);
          _u.searchParams.set("v", version);
          return _u.toString();
        };
        tr.addEventListener("load-model", ({ scene: tileScene }: any) => {
          log("tiles: load-model", { sceneId: tileScene?.uuid });
          if (onModel) onModel(tileScene);
        });
        tr.addEventListener("dispose-model", ({ scene: tileScene }: any) => {
          log("tiles: dispose-model", { sceneId: tileScene?.uuid });
          const bag = physicsForTileScene.get(tileScene);
          if (bag && world) {
            bag.colliders.forEach((c) => world.removeCollider(c, true));
            bag.bodies.forEach((b) => world.removeRigidBody(b));
          }
          physicsForTileScene.delete(tileScene);
        });
        tilesRenderers.push(tr);
        log("tiles: renderer created and added", { assetId });
        return tr;
      }

      function toTHREEMatrix4FromCesium(m: Cesium.Matrix4) {
        const e = new THREE.Matrix4();
        const arr = new Array(16);
        Cesium.Matrix4.toArray(m, arr);
        e.fromArray(arr);
        return e;
      }
      function applyGroupECEFtoLocalTransform(group: THREE.Group) {
        group.matrixAutoUpdate = false;
        group.matrix.copy(ecefToLocal_THREE);
        group.matrix.decompose(group.position, group.quaternion, group.scale);
      }
      async function waitForTilesetBounds(tr: TilesRenderer) {
        log("tiles: waiting for tileset bounds");
        return new Promise<void>((resolve) => {
          console.time("tilesetBounds");
          const start = performance.now();
          const MAX_MS = 15000;
          const tick = () => {
            // Drive tiles renderer while we wait so network requests can happen
            tr.setCamera(camera);
            tr.setResolutionFromRenderer(camera, renderer);
            camera.updateMatrixWorld();
            tr.update();
            const s = new THREE.Sphere();
            if (tr.getBoundingSphere(s)) {
              resolve();
              return;
            }
            if (performance.now() - start > MAX_MS) {
              warn("tiles: bounds wait timeout reached (15s) – continuing");
              resolve();
              return;
            }
            requestAnimationFrame(tick);
          };
          tick();
        });
      }
      async function initLocalFrameFromTiles(_tilesRenderer: TilesRenderer) {
        // Fixed popular location: Times Square, NYC
        const lonDeg = -73.9855; // West
        const latDeg = 40.7580;  // North
        const height = 30;       // meters above ellipsoid
        const carto = Cesium.Cartographic.fromDegrees(lonDeg, latDeg, height);
        const centerECEF = Cesium.Ellipsoid.WGS84.cartographicToCartesian(carto);
        localToEcef_CESIUM = Cesium.Transforms.northUpEastToFixedFrame(centerECEF);
        const ecefToLocal_CESIUM = Cesium.Matrix4.inverse(localToEcef_CESIUM, new Cesium.Matrix4());
        ecefToLocal_THREE = toTHREEMatrix4FromCesium(ecefToLocal_CESIUM);
        if (logEl) logEl.textContent = `Local frame @ lon ${lonDeg.toFixed(5)}, lat ${latDeg.toFixed(5)} (Y=Up)`;
        console.timeEnd("tilesetBounds");
        log("frame: local Y-up initialized (fixed city)", { lon: lonDeg.toFixed(5), lat: latDeg.toFixed(5) });
      }

      function addFixedTrimeshCollidersForTileScene(tileScene: THREE.Group) {
        const bag = { bodies: [] as import("@dimforge/rapier3d-compat").RigidBody[], colliders: [] as import("@dimforge/rapier3d-compat").Collider[] };
        tileScene.updateWorldMatrix(true, true);
        tileScene.traverse((obj: THREE.Object3D) => {
          if (!obj.isMesh || !obj.geometry || !obj.geometry.attributes?.position) return;
          const geo = obj.geometry as THREE.BufferGeometry;
          const posAttr = geo.attributes.position as THREE.BufferAttribute;
          const indexAttr = geo.index;
          const vertices = new Float32Array(posAttr.count * 3);
          const v = new THREE.Vector3();
          const m = obj.matrixWorld;
          for (let i = 0; i < posAttr.count; i++) {
            v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(m);
            vertices[i * 3 + 0] = v.x;
            vertices[i * 3 + 1] = v.y;
            vertices[i * 3 + 2] = v.z;
          }
          let indices: Uint32Array;
          if (indexAttr) {
            const src = indexAttr.array as Uint32Array | Uint16Array | Uint8Array;
            indices = src.BYTES_PER_ELEMENT === 4 ? new Uint32Array(src) : new Uint32Array(src.length);
            if (!(src.BYTES_PER_ELEMENT === 4)) for (let i = 0; i < src.length; i++) indices[i] = src[i];
          } else {
            indices = new Uint32Array(posAttr.count);
            for (let i = 0; i < indices.length; i++) indices[i] = i;
          }
          const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
          const colDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
          try { colDesc.setFriction(0.9); } catch {}
          const col = world.createCollider(colDesc, rb);
          bag.bodies.push(rb);
          bag.colliders.push(col);
        });
        physicsForTileScene.set(tileScene, bag);
      }

      async function buildTerrainHeightfieldAroundTileset({ halfSizeMeters = 1000, divisions = 64 }: { halfSizeMeters?: number; divisions?: number; }) {
        log("terrain: creating provider & sampling", { halfSizeMeters, divisions });
        console.time("terrainProvider");
        const terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(1);
        console.timeEnd("terrainProvider");
        const N = divisions, M = divisions;
        const stepX = (halfSizeMeters * 2) / N;
        const stepZ = (halfSizeMeters * 2) / M;
        const cartos: Cesium.Cartographic[] = [];
        const local = new Cesium.Cartesian3();
        const ecef = new Cesium.Cartesian3();
        const E2F = localToEcef_CESIUM;
        for (let iz = 0; iz <= M; iz++) {
          const z = -halfSizeMeters + iz * stepZ;
          for (let ix = 0; ix <= N; ix++) {
            const x = -halfSizeMeters + ix * stepX;
            local.x = x; local.y = 0; local.z = z;
            Cesium.Matrix4.multiplyByPoint(E2F, local, ecef);
            cartos.push(Cesium.Cartographic.fromCartesian(ecef));
          }
        }
        // Batch sample to limit concurrent requests
        console.time("sampleTerrain");
        const batchSize = 256;
        for (let i = 0; i < cartos.length; i += batchSize) {
          const slice = cartos.slice(i, i + batchSize);
          await Cesium.sampleTerrainMostDetailed(terrainProvider, slice);
        }
        console.timeEnd("sampleTerrain");
        const heightsLocalY = new Float32Array((N + 1) * (M + 1));
        const ecefH = new Cesium.Cartesian3();
        const localOut = new Cesium.Cartesian3();
        const F2E = Cesium.Matrix4.inverse(localToEcef_CESIUM, new Cesium.Matrix4());
        let ptr = 0;
        let minH = Infinity, maxH = -Infinity;
        for (let k = 0; k < cartos.length; k++) {
          Cesium.Ellipsoid.WGS84.cartographicToCartesian(cartos[k], ecefH);
          Cesium.Matrix4.multiplyByPoint(F2E, ecefH, localOut);
          const h = localOut.y;
          heightsLocalY[ptr++] = h;
          if (h < minH) minH = h; if (h > maxH) maxH = h;
        }
        log("terrain: heights sampled", { minH, maxH, count: heightsLocalY.length });
        // Shift heights so minimum is at 0 to avoid negative heights causing traps in Rapier
        if (Number.isFinite(minH) && minH !== 0) {
          const offset = -minH;
          for (let i = 0; i < heightsLocalY.length; i++) {
            heightsLocalY[i] += offset;
          }
          log("terrain: heights shifted", { offset, newMin: 0, newMax: maxH + offset });
          maxH += offset;
          minH = 0;
        }
        const rows = M + 1; // Z dimension
        const cols = N + 1; // X dimension
        const geom = new THREE.BufferGeometry();
        const positions = new Float32Array(rows * cols * 3);
        const indices = new Uint32Array(N * M * 6);
        let p = 0;
        for (let row = 0; row <= M; row++) {
          const z = -halfSizeMeters + row * stepZ;
          for (let col = 0; col <= N; col++) {
            const x = -halfSizeMeters + col * stepX;
            const idx = row * cols + col; // row-major
            positions[p++] = x; positions[p++] = heightsLocalY[idx]; positions[p++] = z;
          }
        }
        let t = 0;
        for (let row = 0; row < M; row++) {
          for (let col = 0; col < N; col++) {
            const a = col + row * cols;
            const b = (col + 1) + row * cols;
            const c = col + (row + 1) * cols;
            const d = (col + 1) + (row + 1) * cols;
            indices[t++] = a; indices[t++] = b; indices[t++] = c;
            indices[t++] = b; indices[t++] = d; indices[t++] = c;
          }
        }
        geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geom.setIndex(new THREE.BufferAttribute(indices, 1));
        geom.computeVertexNormals();
        const mesh = new THREE.Mesh(geom, matTerrain);
        mesh.receiveShadow = true; mesh.castShadow = false;
        const nrows = rows, ncols = cols;
        // Sanitize heights (Rapier can trap on NaN/Inf)
        for (let i = 0; i < heightsLocalY.length; i++) {
          const v = heightsLocalY[i];
          if (!Number.isFinite(v)) heightsLocalY[i] = 0;
        }
        const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
        const scale = { x: halfSizeMeters * 2, y: 1, z: halfSizeMeters * 2 };
        try {
          const collider = RAPIER.ColliderDesc.heightfield(nrows, ncols, heightsLocalY, scale);
          collider.setFriction(1.0);
          world.createCollider(collider, rb);
          log("terrain: mesh + collider ready", { nrows, ncols });
        } catch (e) {
          warn("terrain: heightfield creation failed; falling back to box collider", e);
          const fallback = RAPIER.ColliderDesc.cuboid(halfSizeMeters, 1, halfSizeMeters);
          world.createCollider(fallback, rb);
        }
        return { mesh, nrows, ncols, halfSizeMeters, stepX, stepZ, heightsLocalY };
      }

      function clampMeshToTerrainLocalYUp(mesh: THREE.Mesh, terrain: { nrows: number; ncols: number; halfSizeMeters: number; heightsLocalY: Float32Array }) {
        const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
        function heightAt(x: number, z: number) {
          const N = terrain.nrows - 1;
          const M = terrain.ncols - 1;
          const hs = terrain.halfSizeMeters;
          const fx = ((x + hs) / (hs * 2)) * N;
          const fz = ((z + hs) / (hs * 2)) * M;
          const ix = THREE.MathUtils.clamp(Math.floor(fx), 0, N - 1);
          const iz = THREE.MathUtils.clamp(Math.floor(fz), 0, M - 1);
          const tx = THREE.MathUtils.clamp(fx - ix, 0, 1);
          const tz = THREE.MathUtils.clamp(fz - iz, 0, 1);
          const i00 = ix + iz * (N + 1);
          const i10 = (ix + 1) + iz * (N + 1);
          const i01 = ix + (iz + 1) * (N + 1);
          const i11 = (ix + 1) + (iz + 1) * (N + 1);
          const h00 = terrain.heightsLocalY[i00];
          const h10 = terrain.heightsLocalY[i10];
          const h01 = terrain.heightsLocalY[i01];
          const h11 = terrain.heightsLocalY[i11];
          const h0 = h00 * (1 - tx) + h10 * tx;
          const h1 = h01 * (1 - tx) + h11 * tx;
          return h0 * (1 - tz) + h1 * tz;
        }
        mesh.updateMatrixWorld();
        const invMW = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
        for (let i = 0; i < pos.count; i++) {
          const v0 = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
          const h = heightAt(v0.x, v0.z);
          v0.y = h + 0.02;
          v0.applyMatrix4(invMW);
          pos.setXYZ(i, v0.x, v0.y, v0.z);
        }
        pos.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }

      function addTreePlaceholders(tileScene: THREE.Group) {
        const bag = { bodies: [] as import("@dimforge/rapier3d-compat").RigidBody[], colliders: [] as import("@dimforge/rapier3d-compat").Collider[] };
        tileScene.updateWorldMatrix(true, true);
        const mat4 = new THREE.Matrix4(), pos = new THREE.Vector3();
        tileScene.traverse((obj: THREE.Object3D) => {
          if (obj.type === "InstancedMesh") {
            const instancedMesh = obj as THREE.InstancedMesh;
            for (let i = 0; i < instancedMesh.count; i++) {
              instancedMesh.getMatrixAt(i, mat4);
              pos.setFromMatrixPosition(mat4);
              pos.applyMatrix4(obj.matrixWorld);
              addCylinderTree(pos, bag);
            }
          } else if (obj.isMesh) {
            obj.geometry.computeBoundingBox();
            const c = obj.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(obj.matrixWorld);
            addCylinderTree(c, bag);
          }
        });
        physicsForTileScene.set(tileScene, bag);
        function addCylinderTree(worldPos: THREE.Vector3, bag: { bodies: import("@dimforge/rapier3d-compat").RigidBody[]; colliders: import("@dimforge/rapier3d-compat").Collider[] }) {
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 6, 12), matTrees);
          m.position.copy(worldPos); m.position.y += 3;
          scene.add(m);
          const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
          const colDesc = RAPIER.ColliderDesc.cylinder(3, 0.4);
          colDesc.setFriction(0.8);
          colDesc.setTranslation(worldPos.x, worldPos.y + 3, worldPos.z);
          const col = world.createCollider(colDesc, rb);
          bag.bodies.push(rb);
          bag.colliders.push(col);
        }
      }

      function makePlayerController() {
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 15, 0));
        const collider = world.createCollider(RAPIER.ColliderDesc.capsule(1.0, 0.5).setFriction(0.0), body);
        const controller = world.createCharacterController(0.05);
        controller.enableAutostep(0.5, 0.2, true);
        controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
        controller.setMinSlopeSlideAngle((30 * Math.PI) / 180);
        controller.enableSnapToGround(0.5);
        const keys = new Set<string>();
        const onKeyDown = (e: KeyboardEvent) => keys.add(e.code);
        const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        cleanupFns.push(() => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); });
        let yaw = 0;
        const move = new THREE.Vector3();
        const camOffset = new THREE.Vector3(0, 2.5, -6);
        const speedBase = 8;
        function step(dt: number) {
          if (!world) return;
          if (keys.has("ArrowLeft")) yaw += 1.8 * dt;
          if (keys.has("ArrowRight")) yaw -= 1.8 * dt;
          let speed = speedBase;
          if (keys.has("ArrowUp")) speed *= 1.6;
          if (keys.has("ArrowDown")) speed *= 0.5;
          move.set(0, 0, 0);
          const fwd = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
          const right = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
          if (keys.has("KeyW")) move.add(fwd);
          if (keys.has("KeyS")) move.sub(fwd);
          if (keys.has("KeyD")) move.add(right);
          if (keys.has("KeyA")) move.sub(right);
          if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);
          const gravity = -6.5 * dt; move.y += gravity;
          if (keys.has("Space")) move.y += 4.0 * dt;
          controller.computeColliderMovement(collider, { x: move.x, y: move.y, z: move.z });
          const out = controller.computedMovement();
          const cur = body.translation();
          body.setNextKinematicTranslation({ x: cur.x + out.x, y: cur.y + out.y, z: cur.z + out.z });
          const head = new THREE.Vector3(cur.x, cur.y + 1.5, cur.z);
          const camRel = new THREE.Vector3().copy(camOffset);
          camRel.applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
          camera.position.set(head.x + camRel.x, head.y + camRel.y, head.z + camRel.z);
          const look = new THREE.Vector3().copy(head).addScaledVector(fwd, 2);
          camera.lookAt(look);
        }
        return { step };
      }

      // --- Load tilesets, terrain, and create world ---
      log("tiles: creating buildings tiles renderer");
      const buildingsTR = await makeTilesRendererFromIonAsset(96188, {
        onModel: (tileScene) => {
          tileScene.traverse((obj: any) => { if (obj.isMesh) obj.material = matBuildings; });
          addFixedTrimeshCollidersForTileScene(tileScene);
        },
      });
      log("tiles: buildings tiles renderer created");
      scene.add(buildingsTR.group);
      log("tiles: buildings tiles renderer added");
      await waitForTilesetBounds(buildingsTR);
      log("tiles: buildings tiles renderer bounds ready");
      await initLocalFrameFromTiles(buildingsTR);
      log("tiles: buildings tiles renderer local frame initialized");
      applyGroupECEFtoLocalTransform(buildingsTR.group);
      log("tiles: buildings tiles renderer ECEF to local transform applied");

      log("rapier: creating world");
      world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      const terrain = await buildTerrainHeightfieldAroundTileset({ halfSizeMeters: 600, divisions: 32 });
      scene.add(terrain.mesh);

      const player = makePlayerController();
      log("player: controller ready");

      let lastT = performance.now();
      const loop = (now: number) => {
        rafId = requestAnimationFrame(loop);
        const dt = Math.min(0.033, (now - lastT) / 1000);
        lastT = now;
        camera.updateMatrixWorld();
        tilesRenderers.forEach((tr) => tr.update());
        player.step(dt);
        if (world) world.step();
        renderer.render(scene, camera);
      };
      rafId = requestAnimationFrame(loop);
      log("loop: started");
      cleanupFns.push(() => { if (rafId !== null) cancelAnimationFrame(rafId); });
    };

    run().catch((e) => err("boot: fatal error", e));

    return () => {
      destroyed = true;
      cleanupFns.reverse().forEach((fn) => { try { fn(); } catch {} });
    };
  }, [cesiumIonToken]);
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#0b0e12", overflow: "hidden" }}>
      <div
        id="overlay"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          fontFamily:
            "ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji",
          color: "#cbd5e1",
          background: "linear-gradient(#0b0e12aa,#0b0e12aa)",
          padding: ".5rem .75rem",
          display: "flex",
          gap: "1rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div>
          <strong>Controls</strong> WASD to move, ↑↓ to move faster/slower, ←→ to turn. Space: jump.
        </div>
        <div id="log" style={{ opacity: 0.7, fontSize: ".85rem" }} />
      </div>
      <canvas ref={canvasRef} id="canvas" style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

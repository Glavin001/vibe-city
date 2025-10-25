import { atlasHelpers } from './atlas';

export const volumetricCompositeShader = /* glsl */ `
precision highp float;

uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tDensity;

uniform float uGrid;
uniform float uTilesX;
uniform float uTilesY;
uniform vec2  uAtlasSize;

uniform vec3  uTileMin;
uniform vec3  uTileMax;
uniform float uVoxelWorldSize;
uniform float uKappa;
uniform vec3  uAlbedo;
uniform float uStepWorld;
uniform float uMaxSteps;

uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 invProjectionMatrix;
uniform mat4 invViewMatrix;

varying vec2 vUv;

${atlasHelpers}

vec2 intersectAABB(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv;
  vec3 t1 = (bmax - ro) * inv;
  vec3 tsm = min(t0, t1);
  vec3 tbg = max(t0, t1);
  float tEnter = max(max(tsm.x, tsm.y), tsm.z);
  float tExit  = min(min(tbg.x, tbg.y), tbg.z);
  return vec2(tEnter, tExit);
}

vec3 worldPosFromDepth(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = invProjectionMatrix * clip;
  view /= view.w;
  vec4 world = invViewMatrix * view;
  return world.xyz;
}

void main() {
  vec2 uv = vUv;

  vec3 sceneCol = texture2D(tScene, uv).rgb;
  float depth = texture2D(tDepth, uv).x;

  vec3 camPos = (invViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 wsAtDepth = worldPosFromDepth(uv, depth);
  vec3 rd = normalize(wsAtDepth - camPos);

  vec2 tAB = intersectAABB(camPos, rd, uTileMin, uTileMax);
  float tEnter = max(tAB.x, 0.0);
  float tExit = tAB.y;

  if (tExit <= tEnter) {
    gl_FragColor = vec4(sceneCol, 1.0);
    return;
  }

  float tScene = length(wsAtDepth - camPos);
  tExit = min(tExit, tScene);

  float stepLen = uStepWorld;
  int MAX_STEPS = int(uMaxSteps);
  float t = tEnter;
  vec3 accum = vec3(0.0);
  float Tr = 1.0;

  vec2 atlasSize = vec2(uTilesX * uGrid, uTilesY * uGrid);

  for (int i = 0; i < 2048; ++i) {
    if (i >= MAX_STEPS) break;
    if (t > tExit || Tr < 0.01) break;

    vec3 wp = camPos + rd * t;
    vec3 lp = (wp - uTileMin) / (uTileMax - uTileMin);

    if (any(lessThan(lp, vec3(0.0))) || any(greaterThan(lp, vec3(1.0)))) {
      t += stepLen;
      continue;
    }

    float densKgPerVoxel = sample3DAtlas(tDensity, lp, uGrid, uTilesX, uTilesY, atlasSize).r;
    float conc = densKgPerVoxel / (uVoxelWorldSize * uVoxelWorldSize * uVoxelWorldSize);

    float tau = uKappa * conc * stepLen;
    float a = 1.0 - exp(-tau);

    vec3 col = uAlbedo * a;

    accum += Tr * col;
    Tr *= (1.0 - a);

    t += stepLen;
  }

  vec3 outCol = sceneCol * Tr + accum;
  gl_FragColor = vec4(outCol, 1.0);
}
`;

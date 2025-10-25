import { atlasHelpers } from "./atlas";

export const advectDensityShader = /* glsl */ `
precision highp float;

uniform float uGrid;
uniform float uTilesX;
uniform float uTilesY;
uniform vec2  uAtlasSize;

uniform float uDt;
uniform float uDissipation;
uniform vec3  uTileMin;
uniform vec3  uTileMax;
uniform float uVoxelWorldSize;

uniform int   uEmit;
uniform vec3  uEmitterCenterLocal;
uniform float uEmitterRadiusMeters;
uniform float uEmitterMassRateKgPerSec;

${atlasHelpers}

void main() {
  vec3 ijk, uvw;
  fragcoord_to_ijk(gl_FragCoord.xy, uGrid, uTilesX, ijk, uvw);

  vec3 vel = sample3DAtlas(tVelocity, uvw, uGrid, uTilesX, uTilesY, uAtlasSize).xyz;
  vec3 prev = clamp(uvw - uDt * vel / vec3(uGrid), 0.0, 1.0);

  float dens = sample3DAtlas(tDensity, prev, uGrid, uTilesX, uTilesY, uAtlasSize).r;

  dens *= uDissipation;

  if (uEmit == 1) {
    vec3 dLocal = (uvw - uEmitterCenterLocal) * (uGrid * uVoxelWorldSize);
    float r = length(dLocal);
    float sigma = max(0.25 * uEmitterRadiusMeters, 0.001);
    float gaussian = exp(-0.5 * (r * r) / (sigma * sigma));
    float norm = 0.0635 / (sigma * sigma * sigma + 1e-6);
    float addMassPerVoxel = uEmitterMassRateKgPerSec * uDt * gaussian * norm;
    dens += addMassPerVoxel;
  }

  gl_FragColor = vec4(dens, 0.0, 0.0, 0.0);
}
`;

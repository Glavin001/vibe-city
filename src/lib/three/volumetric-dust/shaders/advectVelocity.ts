import { atlasHelpers } from "./atlas";

export const advectVelocityShader = /* glsl */ `
precision highp float;
uniform float uGrid;
uniform float uTilesX;
uniform float uTilesY;
uniform vec2  uAtlasSize;

uniform float uDt;
uniform float uDamping;
uniform float uBuoyancy;

uniform vec3  uTileMin;
uniform vec3  uTileMax;

${atlasHelpers}

void main() {
  vec3 ijk, uvw;
  fragcoord_to_ijk(gl_FragCoord.xy, uGrid, uTilesX, ijk, uvw);

  vec3 vel = sample3DAtlas(tVelocity, uvw, uGrid, uTilesX, uTilesY, uAtlasSize).xyz;

  vec3 prev = clamp(uvw - uDt * vel / vec3(uGrid), 0.0, 1.0);

  vec3 vPrev = sample3DAtlas(tVelocity, prev, uGrid, uTilesX, uTilesY, uAtlasSize).xyz;

  vPrev += vec3(0.0, uBuoyancy, 0.0) * uDt;

  vPrev *= uDamping;

  gl_FragColor = vec4(vPrev, 0.0);
}
`;

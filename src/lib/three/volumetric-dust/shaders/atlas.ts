export const atlasHelpers = /* glsl */ `
vec2 atlasUV(float x, float y, float z, float uGrid, float uTilesX, float uTilesY, vec2 uAtlasSize) {
  float slice = z;
  float tx = mod(slice, uTilesX);
  float ty = floor(slice / uTilesX);
  float u = (x + 0.5 + tx * uGrid) / (uTilesX * uGrid);
  float v = (y + 0.5 + ty * uGrid) / (uTilesY * uGrid);
  return vec2(u, v);
}

vec4 fetchVoxel(sampler2D tex, vec3 ijk, float uGrid, float uTilesX, float uTilesY, vec2 uAtlasSize) {
  vec2 uv = atlasUV(ijk.x, ijk.y, ijk.z, uGrid, uTilesX, uTilesY, uAtlasSize);
  return texture2D(tex, uv);
}

vec4 sample3DAtlas(sampler2D tex, vec3 uvw, float uGrid, float uTilesX, float uTilesY, vec2 uAtlasSize) {
  vec3 coord = clamp(uvw * (uGrid - 1.0), 0.0, uGrid - 1.0001);
  vec3 base = floor(coord);
  vec3 f = fract(coord);

  vec3 c000 = base;
  vec3 c100 = base + vec3(1.0, 0.0, 0.0);
  vec3 c010 = base + vec3(0.0, 1.0, 0.0);
  vec3 c110 = base + vec3(1.0, 1.0, 0.0);
  vec3 c001 = base + vec3(0.0, 0.0, 1.0);
  vec3 c101 = base + vec3(1.0, 0.0, 1.0);
  vec3 c011 = base + vec3(0.0, 1.0, 1.0);
  vec3 c111 = base + vec3(1.0, 1.0, 1.0);

  vec4 s000 = fetchVoxel(tex, c000, uGrid, uTilesX, uTilesY, uAtlasSize);
  vec4 s100 = fetchVoxel(tex, c100, uGrid, uTilesX, uTilesY, uAtlasSize);
  vec4 s010 = fetchVoxel(tex, c010, uGrid, uTilesX, uTilesY, uAtlasSize);
  vec4 s110 = fetchVoxel(tex, c110, uGrid, uTilesX, uTilesY, uAtlasSize);
  vec4 s001 = fetchVoxel(tex, c001, uGrid, uTilesX, uTilesY, uAtlasSize);
  vec4 s101 = fetchVoxel(tex, c101, uGrid, uTilesX, uTilesY, uAtlasSize);
  vec4 s011 = fetchVoxel(tex, c011, uGrid, uTilesX, uTilesY, uAtlasSize);
  vec4 s111 = fetchVoxel(tex, c111, uGrid, uTilesX, uTilesY, uAtlasSize);

  vec4 s00 = mix(s000, s100, f.x);
  vec4 s10 = mix(s010, s110, f.x);
  vec4 s01 = mix(s001, s101, f.x);
  vec4 s11 = mix(s011, s111, f.x);

  vec4 s0 = mix(s00, s10, f.y);
  vec4 s1 = mix(s01, s11, f.y);

  return mix(s0, s1, f.z);
}

void fragcoord_to_ijk(vec2 fragCoord, float uGrid, float uTilesX, out vec3 ijk, out vec3 uvw) {
  float px = fragCoord.x - 0.5;
  float py = fragCoord.y - 0.5;

  float tx = floor(px / uGrid);
  float ty = floor(py / uGrid);

  float i = px - tx * uGrid;
  float j = py - ty * uGrid;
  float k = tx + ty * uTilesX;

  ijk = vec3(i, j, k);
  uvw = (ijk + 0.5) / vec3(uGrid);
}
`;

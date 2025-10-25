precision highp float;
precision highp sampler2D;

#define MAX_SPHERES 4
#define MAX_BOXES 6

uniform float uTime;
uniform float uDelta;

uniform vec3 uGravity;
uniform float uDrag;
uniform float uBounce;
uniform float uFriction;

uniform sampler2D uHeightTex;
uniform vec2 uTerrainMin;
uniform vec2 uTerrainMax;
uniform float uHeightScale;
uniform vec2 uHeightTexel;

uniform int uSphereCount;
uniform vec4 uSpheres[MAX_SPHERES];
uniform int uBoxCount;
uniform vec4 uBoxesMin[MAX_BOXES];
uniform vec4 uBoxesMax[MAX_BOXES];

uniform int uCapacity;
uniform ivec2 uResolution;
uniform int uSpawnStartA;
uniform int uSpawnCountA;
uniform int uSpawnStartB;
uniform int uSpawnCountB;
uniform vec3 uSpawnPos;
uniform vec3 uSpawnDir;
uniform vec2 uSpawnSpeedRange;
uniform float uSpawnSpread;
uniform float uSpawnTTL;
uniform int uSpawnType;

int indexOfFrag() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  return pix.x + pix.y * uResolution.x;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 worldToHeightUV(vec2 xz) {
  vec2 uv = (xz - uTerrainMin) / (uTerrainMax - uTerrainMin);
  return clamp(uv, 0.0, 1.0);
}

float terrainHeight(vec2 xz) {
  vec2 uv = worldToHeightUV(xz);
  return texture2D(uHeightTex, uv).r * uHeightScale;
}

vec3 terrainNormal(vec2 xz) {
  vec2 uv = worldToHeightUV(xz);
  float hL = texture2D(uHeightTex, uv - vec2(uHeightTexel.x, 0.0)).r * uHeightScale;
  float hR = texture2D(uHeightTex, uv + vec2(uHeightTexel.x, 0.0)).r * uHeightScale;
  float hD = texture2D(uHeightTex, uv - vec2(0.0, uHeightTexel.y)).r * uHeightScale;
  float hU = texture2D(uHeightTex, uv + vec2(0.0, uHeightTexel.y)).r * uHeightScale;
  return normalize(vec3(hL - hR, 2.0, hD - hU));
}

void collideTerrain(inout vec3 p, inout vec3 v) {
  float h = terrainHeight(p.xz);
  if (p.y < h) {
    vec3 n = terrainNormal(p.xz);
    p.y = h + 0.001;
    float vn = dot(v, n);
    if (vn < 0.0) {
      v -= (1.0 + uBounce) * vn * n;
    }
    v -= uFriction * (v - dot(v, n) * n);
  }
}

void collideSphere(inout vec3 p, inout vec3 v, vec3 c, float r) {
  vec3 d = p - c;
  float dist = length(d);
  if (dist < r) {
    vec3 n = d / max(dist, 1e-6);
    p = c + n * (r + 0.001);
    float vn = dot(v, n);
    if (vn < 0.0) {
      v -= (1.0 + uBounce) * vn * n;
    }
    v -= uFriction * (v - dot(v, n) * n);
  }
}

float sdBox(vec3 p, vec3 c, vec3 halfExtent) {
  vec3 d = abs(p - c) - halfExtent;
  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

vec3 boxNormal(vec3 p, vec3 c, vec3 halfExtent) {
  float eps = 0.01;
  float d0 = sdBox(p, c, halfExtent);
  vec3 n;
  n.x = sdBox(p + vec3(eps, 0.0, 0.0), c, halfExtent) - d0;
  n.y = sdBox(p + vec3(0.0, eps, 0.0), c, halfExtent) - d0;
  n.z = sdBox(p + vec3(0.0, 0.0, eps), c, halfExtent) - d0;
  return normalize(n);
}

void collideAABB(inout vec3 p, inout vec3 v, vec3 bmin, vec3 bmax) {
  vec3 c = 0.5 * (bmin + bmax);
  vec3 halfExtent = 0.5 * (bmax - bmin);
  float d = sdBox(p, c, halfExtent);
  if (d < 0.0) {
    vec3 n = boxNormal(p, c, halfExtent);
    p -= n * (d - 0.001);
    float vn = dot(v, n);
    if (vn < 0.0) {
      v -= (1.0 + uBounce) * vn * n;
    }
    v -= uFriction * (v - dot(v, n) * n);
  }
}

vec3 randDirInCone(vec3 dir, float spread, float rnd1, float rnd2) {
  float cosT = mix(1.0, cos(spread), rnd1);
  float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
  float phi = 6.2831853 * rnd2;
  vec3 w = normalize(dir);
  vec3 u = normalize(abs(w.y) < 0.999 ? cross(vec3(0.0, 1.0, 0.0), w) : cross(vec3(1.0, 0.0, 0.0), w));
  vec3 v = cross(w, u);
  return normalize(u * cos(phi) * sinT + v * sin(phi) * sinT + w * cosT);
}

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(uResolution);
  vec4 pos4 = texture2D(texturePosition, uv);
  vec4 vel4 = texture2D(textureVelocity, uv);
  vec3 p = pos4.xyz;
  vec3 v = vel4.xyz;
  float type = vel4.w;

  int idx = indexOfFrag();
  bool spawnHere = false;
  if (uSpawnCountA > 0 && idx >= uSpawnStartA && idx < (uSpawnStartA + uSpawnCountA)) {
    spawnHere = true;
  }
  if (uSpawnCountB > 0 && idx >= uSpawnStartB && idx < (uSpawnStartB + uSpawnCountB)) {
    spawnHere = true;
  }

  if (spawnHere) {
    float r1 = hash12(vec2(float(idx), uTime));
    float r2 = hash12(vec2(float(idx) + 17.0, uTime * 0.73));
    float r3 = hash12(vec2(float(idx) + 31.0, uTime * 1.37));
    vec3 dir = randDirInCone(normalize(uSpawnDir), uSpawnSpread, r1, r2);
    float speed = mix(uSpawnSpeedRange.x, uSpawnSpeedRange.y, r3);
    v = dir * speed;
    type = float(uSpawnType);
    gl_FragColor = vec4(v, type);
    return;
  }

  v += uGravity * uDelta;
  float drag = clamp(uDrag, 0.0, 20.0);
  v *= exp(-drag * uDelta);

  collideTerrain(p, v);

  for (int i = 0; i < MAX_SPHERES; i++) {
    if (i >= uSphereCount) {
      break;
    }
    vec3 c = uSpheres[i].xyz;
    float r = uSpheres[i].w;
    collideSphere(p, v, c, r);
  }

  for (int i = 0; i < MAX_BOXES; i++) {
    if (i >= uBoxCount) {
      break;
    }
    vec3 bmin = uBoxesMin[i].xyz;
    vec3 bmax = uBoxesMax[i].xyz;
    collideAABB(p, v, bmin, bmax);
  }

  gl_FragColor = vec4(v, type);
}

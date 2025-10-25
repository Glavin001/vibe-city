precision highp float;
precision highp sampler2D;

uniform float uDelta;
uniform float uBaseTTL;
uniform float uRestKillRate;
uniform float uRestSpeed;

uniform int uCapacity;
uniform ivec2 uResolution;
uniform int uSpawnStartA;
uniform int uSpawnCountA;
uniform int uSpawnStartB;
uniform int uSpawnCountB;
uniform vec3 uSpawnPos;
uniform float uSpawnTTL;

int indexOfFrag() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  return pix.x + pix.y * uResolution.x;
}

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(uResolution);
  vec4 pos4 = texture2D(texturePosition, uv);
  vec4 vel4 = texture2D(textureVelocity, uv);

  vec3 p = pos4.xyz;
  float ttl = pos4.w;
  vec3 v = vel4.xyz;

  int idx = indexOfFrag();
  bool spawnHere = false;
  if (uSpawnCountA > 0 && idx >= uSpawnStartA && idx < (uSpawnStartA + uSpawnCountA)) {
    spawnHere = true;
  }
  if (uSpawnCountB > 0 && idx >= uSpawnStartB && idx < (uSpawnStartB + uSpawnCountB)) {
    spawnHere = true;
  }

  if (spawnHere) {
    p = uSpawnPos;
    ttl = uSpawnTTL;
    gl_FragColor = vec4(p, ttl);
    return;
  }

  p += v * uDelta;

  float speed = length(v);
  float drain = uDelta;
  if (speed < uRestSpeed) {
    drain += uRestKillRate * uDelta;
  }
  ttl = max(0.0, ttl - drain);

  if (ttl <= 0.0) {
    p.y = -9999.0;
  }

  gl_FragColor = vec4(p, ttl);
}

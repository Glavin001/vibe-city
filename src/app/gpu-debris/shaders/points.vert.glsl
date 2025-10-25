precision highp float;

attribute vec2 aRef;
uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform float uSizeBase;
uniform float uSizeConcrete;
uniform float uSizeSparks;
uniform float uSizeDust;

varying float vType;
varying float vLife;

void main() {
  vec4 pos4 = texture2D(uPosTex, aRef);
  vec4 vel4 = texture2D(uVelTex, aRef);
  vec3 pos = pos4.xyz;
  float ttl = pos4.w;
  float type = vel4.w;

  vType = type;
  vLife = ttl;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float size = uSizeBase;
  if (type < 0.5) {
    size = uSizeConcrete;
  } else if (type < 1.5) {
    size = uSizeSparks;
  } else {
    size = uSizeDust;
  }

  gl_PointSize = size * (300.0 / -mv.z);
}

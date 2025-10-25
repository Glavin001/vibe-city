precision highp float;

varying float vType;
varying float vLife;

void main() {
  vec2 r = gl_PointCoord * 2.0 - 1.0;
  float d = dot(r, r);
  if (d > 1.0) {
    discard;
  }

  vec3 col;
  if (vType < 0.5) {
    col = vec3(0.75, 0.74, 0.72);
  } else if (vType < 1.5) {
    col = mix(vec3(1.0, 0.5, 0.1), vec3(1.0, 0.9, 0.2), clamp(1.0 - d, 0.0, 1.0));
  } else {
    col = vec3(0.62, 0.55, 0.45);
  }

  float alpha = smoothstep(1.0, 0.0, d);
  alpha *= clamp(vLife * 0.5, 0.0, 1.0);

  gl_FragColor = vec4(col, alpha);
}

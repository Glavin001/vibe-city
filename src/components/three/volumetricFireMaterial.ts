import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Matrix4,
  RGBAFormat,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  Vector4,
} from "three";

const fireVertexShader = /* glsl */ `
  varying vec3 vWorldPos;

  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fireFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 baseColor;
  uniform float intensity;
  uniform float time;
  uniform float seed;
  uniform mat4 invModelMatrix;
  uniform vec3 scale;
  uniform vec4 noiseScale;
  uniform float magnitude;
  uniform float lacunarity;
  uniform float gain;
  uniform sampler2D fireTex;
  uniform int shapeType;
  uniform vec4 shapeParams;

  varying vec3 vWorldPos;

  float saturate(float value) {
    return clamp(value, 0.0, 1.0);
  }

  vec3 toLocal(vec3 p) {
    return (invModelMatrix * vec4(p, 1.0)).xyz;
  }

  vec3 safeScale(vec3 s) {
    return max(s, vec3(0.0001));
  }

  // Simplex noise helpers from ashima/webgl-noise
  vec3 mod289(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec4 permute(vec4 x) {
    return mod289(((x * 34.0) + 1.0) * x);
  }

  vec4 taylorInvSqrt(vec4 r) {
    return 1.79284291400159 - 0.85373472095314 * r;
  }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(
      permute(
        permute(
          i.z + vec4(0.0, i1.z, i2.z, 1.0)
        ) + i.y + vec4(0.0, i1.y, i2.y, 1.0)
      ) + i.x + vec4(0.0, i1.x, i2.x, 1.0)
    );

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;

    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  float turbulence(vec3 p) {
    float sum = 0.0;
    float freq = 1.0;
    float amp = 1.0;

    for (int i = 0; i < OCTIVES; i++) {
      sum += abs(snoise(p * freq)) * amp;
      freq *= lacunarity;
      amp *= gain;
    }

    return sum;
  }

  float shapeMask(vec3 localPos, vec3 normalized) {
    vec3 p = normalized * 2.0 - 1.0;
    float softness = max(shapeParams.z, 0.0001);
    float dist;

    if (shapeType == 1) {
      float radius = max(shapeParams.x, 0.0001);
      dist = length(p) - radius;
    } else if (shapeType == 2) {
      float halfThickness = max(shapeParams.x, 0.0001);
      dist = abs(p.y) - halfThickness;
    } else if (shapeType == 3) {
      float major = max(shapeParams.x, 0.0001);
      float minor = max(shapeParams.y, 0.0001);
      vec2 q = vec2(length(p.xz) - major, p.y);
      dist = length(q) - minor;
    } else if (shapeType == 4) {
      float radius = max(shapeParams.x, 0.0001);
      float halfHeight = max(shapeParams.y, 0.0001);
      vec2 d = vec2(length(p.xz) - radius, abs(p.y) - halfHeight);
      dist = min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
    } else {
      vec3 b = vec3(1.0);
      vec3 d = abs(p) - b;
      dist = length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
    }

    return saturate(1.0 - smoothstep(0.0, softness, dist));
  }

  vec2 computeProfileUV(vec3 localPos, vec3 normalized, vec3 s) {
    float radius;

    if (shapeType == 1) {
      float maxAxis = max(s.x, max(s.y, s.z));
      radius = clamp(length(localPos) / max(0.0001, 0.5 * maxAxis), 0.0, 1.0);
    } else if (shapeType == 3) {
      vec3 p = normalized * 2.0 - 1.0;
      float major = max(shapeParams.x, 0.0001);
      float minor = max(shapeParams.y, 0.0001);
      vec2 q = vec2(length(p.xz) - major, p.y);
      radius = clamp(length(q) / minor, 0.0, 1.0);
    } else {
      float denom = max(max(s.x, s.z), 0.0001);
      radius = clamp(length(localPos.xz) / (0.5 * denom), 0.0, 1.0);
    }

    float height = clamp(normalized.y, 0.0, 1.0);
    return vec2(radius, height);
  }

  void main() {
    vec3 rayPos = vWorldPos;
    vec3 rayDir = normalize(rayPos - cameraPosition);
    vec3 s = safeScale(scale);
    float stepSize = 0.03 * length(s);

    vec4 col = vec4(0.0);

    for (int i = 0; i < ITERATIONS; i++) {
      rayPos += rayDir * stepSize;
      vec3 localPos = toLocal(rayPos);
      vec3 normalized = localPos / s + 0.5;

      if (any(lessThan(normalized, vec3(0.0))) || any(greaterThan(normalized, vec3(1.0)))) {
        continue;
      }

      float mask = shapeMask(localPos, normalized);
      if (mask <= 0.0001) {
        continue;
      }

      vec3 noisePoint = localPos;
      noisePoint.y -= (seed + time) * noiseScale.w;
      noisePoint *= noiseScale.xyz;

      float turb = turbulence(noisePoint);
      float height = clamp(normalized.y + pow(normalized.y, 0.5) * magnitude * turb, 0.0, 1.0);

      vec2 st = computeProfileUV(localPos, normalized, s);
      st.y = height;

      if (st.y <= 0.0 || st.y >= 1.0) {
        continue;
      }

      vec4 sampleCol = texture2D(fireTex, st);
      sampleCol.rgb *= mask;
      sampleCol.a *= mask;

      col.rgb += sampleCol.rgb * sampleCol.a;
      col.a += sampleCol.a;
    }

    col.rgb *= baseColor * intensity;
    col.a = saturate(col.a * intensity);

    if (col.a <= 0.0001) {
      discard;
    }

    gl_FragColor = vec4(col.rgb, col.a);
  }
`;

const fireTexture = (() => {
  const saturateScalar = (value: number) => Math.min(Math.max(value, 0), 1);

  const width = 16;
  const height = 256;
  const data = new Uint8Array(width * height * 4);

  const gradientStops = [
    { pos: 0.0, color: new Color(0x050505) },
    { pos: 0.08, color: new Color(0x2b0500) },
    { pos: 0.18, color: new Color(0x7a1100) },
    { pos: 0.32, color: new Color(0xf44800) },
    { pos: 0.5, color: new Color(0xffa000) },
    { pos: 0.7, color: new Color(0xffe08c) },
    { pos: 1.0, color: new Color(0xffffff) },
  ];

  const lerpColor = (t: number) => {
    let lower = gradientStops[0];
    let upper = gradientStops[gradientStops.length - 1];

    for (let i = 0; i < gradientStops.length - 1; i++) {
      const a = gradientStops[i];
      const b = gradientStops[i + 1];
      if (t >= a.pos && t <= b.pos) {
        lower = a;
        upper = b;
        break;
      }
    }

    const span = upper.pos - lower.pos || 1;
    const localT = (t - lower.pos) / span;
    const color = lower.color.clone().lerp(upper.color, localT);
    return color;
  };

  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    const color = lerpColor(t);
    const alpha = Math.pow(saturateScalar(t), 1.5);

    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      data[index] = Math.floor(color.r * 255);
      data[index + 1] = Math.floor(color.g * 255);
      data[index + 2] = Math.floor(color.b * 255);
      data[index + 3] = Math.floor(alpha * 255);
    }
  }

  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
})();

export const createFireMaterial = () => {
  const material = new ShaderMaterial({
    defines: {
      ITERATIONS: "48",
      OCTIVES: "4",
    },
    uniforms: {
      fireTex: { value: fireTexture },
      baseColor: { value: new Color(0xffffff) },
      intensity: { value: 1.5 },
      time: { value: 0 },
      seed: { value: Math.random() * 19.19 },
      invModelMatrix: { value: new Matrix4() },
      scale: { value: new Vector3(1, 1, 1) },
      noiseScale: { value: new Vector4(1, 2, 1, 0.35) },
      magnitude: { value: 1.35 },
      lacunarity: { value: 2.0 },
      gain: { value: 0.5 },
      shapeType: { value: 0 },
      shapeParams: { value: new Vector4(1, 1, 0.4, 0) },
    },
    vertexShader: fireVertexShader,
    fragmentShader: fireFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });

  return material;
};

export type FireShape = "box" | "sphere" | "plane" | "torus" | "cylinder";


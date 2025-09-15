import * as THREE from "three";
import { degToRad } from "three/src/math/MathUtils.js";

const vertexShader = `
  varying vec3 vPosition;
  void main() {
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  precision mediump float;
  varying vec3 vPosition;
  uniform float uSunAzimuth;
  uniform float uSunElevation;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColorLow;
  uniform vec3 uSkyColorHigh;
  uniform float uSunSize;
  void main() {
    float azimuth = radians(uSunAzimuth);
    float elevation = radians(uSunElevation);
    vec3 sunDirection = normalize(vec3(
      cos(elevation) * sin(azimuth),
      sin(elevation),
      cos(elevation) * cos(azimuth)
    ));
    vec3 direction = normalize(vPosition);
    float t = direction.y * 0.5 + 0.5;
    vec3 skyColor = mix(uSkyColorLow, uSkyColorHigh, t);
    float sunIntensity = pow(max(dot(direction, sunDirection), 0.0), 1000.0 / uSunSize);
    vec3 sunColor = uSunColor * sunIntensity;
    vec3 color = skyColor + sunColor;
    gl_FragColor = vec4(color, 1.0);
  }
`;

export class Skybox extends THREE.Mesh {
  sun: THREE.DirectionalLight;
  constructor() {
    super();
    this.name = "Skybox";
    this.geometry = new THREE.SphereGeometry(900, 900, 900);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      uniforms: {
        uSunAzimuth: { value: 90 },
        uSunElevation: { value: 30 },
        uSunColor: { value: new THREE.Color(0xffe5b0).convertLinearToSRGB() },
        uSkyColorLow: { value: new THREE.Color(0x6fa2ef).convertLinearToSRGB() },
        uSkyColorHigh: { value: new THREE.Color(0x2053ff).convertLinearToSRGB() },
        uSunSize: { value: 1 },
      },
    });
    this.sun = new THREE.DirectionalLight(0xffe5b0);
    this.sun.intensity = 5;
    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -100;
    this.sun.shadow.camera.right = 100;
    this.sun.shadow.camera.top = 100;
    this.sun.shadow.camera.bottom = -100;
    this.sun.shadow.mapSize = new THREE.Vector2(512, 512);
    this.sun.shadow.bias = -0.001;
    this.sun.shadow.normalBias = 0.2;
    this.add(this.sun);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.add(ambientLight);
    this.updateSunPosition();
  }
  updateSunPosition() {
    const el = degToRad(this.sunElevation);
    const az = degToRad(this.sunAzimuth);
    this.sun.position.set(
      100 * Math.cos(el) * Math.sin(az),
      100 * Math.sin(el),
      100 * Math.cos(el) * Math.cos(az)
    );
  }
  get sunAzimuth() {
    return (this.material as THREE.ShaderMaterial).uniforms.uSunAzimuth.value;
  }
  set sunAzimuth(azimuth: number) {
    (this.material as THREE.ShaderMaterial).uniforms.uSunAzimuth.value = azimuth;
    this.updateSunPosition();
  }
  get sunElevation() {
    return (this.material as THREE.ShaderMaterial).uniforms.uSunElevation.value;
  }
  set sunElevation(elevation: number) {
    (this.material as THREE.ShaderMaterial).uniforms.uSunElevation.value = elevation;
    this.updateSunPosition();
  }
  get sunColor() {
    return (this.material as THREE.ShaderMaterial).uniforms.uSunColor.value as THREE.Color;
  }
  set sunColor(color: THREE.Color) {
    (this.material as THREE.ShaderMaterial).uniforms.uSunColor.value = color;
    this.sun.color = color;
  }
  get skyColorLow() {
    return (this.material as THREE.ShaderMaterial).uniforms.uSkyColorLow.value as THREE.Color;
  }
  set skyColorLow(color: THREE.Color) {
    (this.material as THREE.ShaderMaterial).uniforms.uSkyColorLow.value = color;
  }
  get skyColorHigh() {
    return (this.material as THREE.ShaderMaterial).uniforms.uSkyColorHigh.value as THREE.Color;
  }
  set skyColorHigh(color: THREE.Color) {
    (this.material as THREE.ShaderMaterial).uniforms.uSkyColorHigh.value = color;
  }
  get sunSize() {
    return (this.material as THREE.ShaderMaterial).uniforms.uSunSize.value;
  }
  set sunSize(size: number) {
    (this.material as THREE.ShaderMaterial).uniforms.uSunSize.value = size;
  }
}

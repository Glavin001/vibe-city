import * as THREE from "three";
import { GRASS_FRAGMENT_SHADER, GRASS_VERTEX_SHADER, type GrassShader } from "./shaders";

type UniformValue = { value: unknown };

type UniformDictionary = Record<string, UniformValue>;

export class GrassV3Material extends THREE.MeshPhongMaterial {
  #shader: GrassShader | null = null;
  #uniforms: UniformDictionary = {};

  constructor(parameters: THREE.MeshPhongMaterialParameters = {}) {
    super({ color: 0xffffff, side: THREE.FrontSide, ...parameters });

    this.#uniforms = {
      time: { value: 0 },
      grassSize: { value: new THREE.Vector2(0.1, 1.0) },
      grassParams: { value: new THREE.Vector4() },
      grassDraw: { value: new THREE.Vector4() },
      heightmap: { value: null },
      heightParams: { value: new THREE.Vector4() },
      playerPos: { value: new THREE.Vector3() },
      viewMatrixInverse: { value: new THREE.Matrix4() },
      grassLODColour: { value: new THREE.Vector3(0, 0, 0) },
    };

    this.onBeforeCompile = (shader) => {
      shader.vertexShader = GRASS_VERTEX_SHADER;
      shader.fragmentShader = GRASS_FRAGMENT_SHADER;
      shader.uniforms = {
        ...shader.uniforms,
        ...this.#uniforms,
      };
      this.#shader = shader;
    };

    this.customProgramCacheKey = () => {
      const keys = Object.keys(this.#uniforms).sort();
      let cacheKey = "GrassV3Material";
      for (const key of keys) {
        const uniform = this.#uniforms[key];
        const value = uniform.value;
        if (value === null || value === undefined) {
          cacheKey += `|${key}:null`;
        } else if (typeof value === "number") {
          cacheKey += `|${key}:${value}`;
        } else if (value instanceof THREE.Vector2 || value instanceof THREE.Vector3 || value instanceof THREE.Vector4) {
          cacheKey += `|${key}:${value.toArray().join(",")}`;
        } else if (value instanceof THREE.Matrix4) {
          cacheKey += `|${key}:${value.toArray().join(",")}`;
        } else if (value instanceof THREE.Texture) {
          cacheKey += `|${key}:${value.uuid}`;
        } else {
          cacheKey += `|${key}:${JSON.stringify(value)}`;
        }
      }
      return cacheKey;
    };
  }

  #setUniform(name: string, value: unknown) {
    if (!this.#uniforms[name]) {
      this.#uniforms[name] = { value };
    } else {
      this.#uniforms[name].value = value;
    }

    if (this.#shader) {
      if (!this.#shader.uniforms[name]) {
        this.#shader.uniforms[name] = this.#uniforms[name];
      }
      this.#shader.uniforms[name].value = value;
    }
  }

  setFloat(name: string, value: number) {
    this.#setUniform(name, value);
  }

  setVec2(name: string, value: THREE.Vector2) {
    this.#setUniform(name, value);
  }

  setVec3(name: string, value: THREE.Vector3) {
    this.#setUniform(name, value);
  }

  setVec4(name: string, value: THREE.Vector4) {
    this.#setUniform(name, value);
  }

  setMatrix(name: string, value: THREE.Matrix4) {
    this.#setUniform(name, value);
  }

  setTexture(name: string, value: THREE.Texture | null) {
    this.#setUniform(name, value);
  }
}

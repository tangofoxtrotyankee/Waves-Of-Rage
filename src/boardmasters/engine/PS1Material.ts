import { FOG, LIGHT, LOOK, VIEW } from '../game/constants';
import { rgb } from './math';
import { THREE } from './three';

/**
 * The one material everything in the world uses. It produces the
 * PlayStation look in the shader rather than as a filter:
 *
 *  - vertex snapping: clip-space positions are snapped to the low-res pixel
 *    grid, so polygons jitter as they move (uSnap, LOOK.snap)
 *  - affine texture mapping: uv*w and w are interpolated and divided in the
 *    fragment, which is screen-linear rather than perspective-correct, so
 *    textures warp on polygons seen at an angle (uAffine, LOOK.affine)
 *  - Gouraud lighting: one sun plus ambient, evaluated per vertex, times
 *    vertex colours, times an optional nearest-filtered texture
 *  - linear fog to the sunset colour (the short draw distance)
 *  - 5-bit colour quantisation (banding) (uQuantize, LOOK.quantize)
 *
 * Every geometry must carry a `color` attribute (see colorGeometry).
 */
export const sharedUniforms = {
  uSnap: { value: new THREE.Vector2(VIEW.width / 2, VIEW.height / 2) },
  uAffine: { value: 1 },
  uQuantize: { value: 1 },
  uFogColor: { value: new THREE.Color(FOG.color) },
  uFogNear: { value: FOG.near },
  uFogFar: { value: FOG.far },
  uSunDir: { value: new THREE.Vector3(...LIGHT.sun).normalize() },
  uAmbient: { value: LIGHT.ambient },
};

/** Push the LOOK toggles into the shared uniforms (called every frame; cheap). */
export function syncLook(): void {
  sharedUniforms.uSnap.value.set(LOOK.snap ? VIEW.width / 2 : 0, LOOK.snap ? VIEW.height / 2 : 0);
  sharedUniforms.uAffine.value = LOOK.affine ? 1 : 0;
  sharedUniforms.uQuantize.value = LOOK.quantize ? 1 : 0;
}

const vertexShader = /* glsl */ `
uniform vec2 uSnap;
uniform vec3 uSunDir;
uniform float uAmbient;
uniform float uUnlit;
uniform float uFogNear;
uniform float uFogFar;
uniform float uUseFog;

varying vec3 vColor;
varying vec2 vUvPersp;
varying vec3 vUvAffine;
varying float vLight;
varying float vFog;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mvPosition;

  // PS1 vertex snapping: round the projected position to the pixel grid.
  if (uSnap.x > 0.0 && clip.w > 0.0) {
    vec2 ndc = clip.xy / clip.w;
    ndc = floor(ndc * uSnap + 0.5) / uSnap;
    clip.xy = ndc * clip.w;
  }
  gl_Position = clip;

  vUvPersp = uv;
  vUvAffine = vec3(uv * clip.w, clip.w);

  vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
  float diffuse = max(dot(worldNormal, uSunDir), 0.0);
  vLight = mix(uAmbient + (1.0 - uAmbient) * diffuse, 1.0, uUnlit);
  vColor = color;

  float depth = -mvPosition.z;
  vFog = uUseFog * clamp((depth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform float uUseMap;
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uAffine;
uniform float uQuantize;
uniform float uFlash;
uniform float uOpacity;

varying vec3 vColor;
varying vec2 vUvPersp;
varying vec3 vUvAffine;
varying float vLight;
varying float vFog;

void main() {
  vec2 uv = mix(vUvPersp, vUvAffine.xy / vUvAffine.z, uAffine);
  vec3 base = uColor * vColor;
  if (uUseMap > 0.5) base *= texture2D(uMap, uv).rgb;
  vec3 lit = mix(base * vLight, vec3(1.0), uFlash);
  vec3 col = mix(lit, uFogColor, vFog);
  if (uQuantize > 0.5) col = floor(col * 31.0 + 0.5) / 31.0;
  gl_FragColor = vec4(col, uOpacity);
}
`;

export interface PS1MaterialOptions {
  map?: THREE.Texture;
  color?: number;
  /** Skip lighting (sky, sun, spray, shadows). */
  unlit?: boolean;
  /** Fog off for things that sit at the horizon. */
  fog?: boolean;
  opacity?: number;
  side?: THREE.Side;
  depthWrite?: boolean;
}

export function createPS1Material(options: PS1MaterialOptions = {}): THREE.ShaderMaterial {
  const { map, color = 0xffffff, unlit = false, fog = true, opacity = 1, side = THREE.FrontSide, depthWrite = true } = options;
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uMap: { value: map ?? null },
      uUseMap: { value: map ? 1 : 0 },
      uColor: { value: new THREE.Color(color) },
      uUnlit: { value: unlit ? 1 : 0 },
      uUseFog: { value: fog ? 1 : 0 },
      uOpacity: { value: opacity },
      uFlash: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    vertexColors: true,
    transparent: opacity < 1,
    depthWrite,
    side,
  });
}

/** Give a geometry a solid vertex colour (the shader requires the attribute). */
export function colorGeometry<T extends THREE.BufferGeometry>(geometry: T, color: number): T {
  const count = geometry.getAttribute('position').count;
  const [r, g, b] = rgb(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Per-vertex colours from a function of the vertex position. */
export function paintGeometry<T extends THREE.BufferGeometry>(geometry: T, paint: (x: number, y: number, z: number) => [number, number, number]): T {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const [r, g, b] = paint(position.getX(i), position.getY(i), position.getZ(i));
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

import { CAMERA, FOG, RENDER_SCALE, VIEW } from '../game/constants';
import { THREE } from './three';

/**
 * The 3D canvas and the 2D HUD canvas. The HUD is drawn at the internal
 * resolution (VIEW: 426x240, or 240x426 upright); the world at RENDER_SCALE
 * times that (1.5x by default, `?res=1` for 1x). Both are scaled up to the same
 * CSS rectangle, the largest fit, with nearest-neighbour sampling and centred
 * with letterboxing like the original game's FIT scaling, so one HUD pixel
 * always covers RENDER_SCALE x RENDER_SCALE world pixels. There is no
 * post-processing pass: the low resolution and the PS1 shader
 * (PS1Material.ts) do all the work.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly hudCanvas: HTMLCanvasElement;
  /** The HUD's (internal) resolution; pointers, touch buttons and the HUD layout use it. */
  readonly width = VIEW.width;
  readonly height = VIEW.height;
  /** The 3D canvas's drawing-buffer size: VIEW times RENDER_SCALE. */
  readonly renderWidth = Math.round(VIEW.width * RENDER_SCALE);
  readonly renderHeight = Math.round(VIEW.height * RENDER_SCALE);
  /** CSS pixels per internal pixel after fitting, and the canvases' offset in the parent; input maps pointers with these. */
  cssScale = 1;
  offsetX = 0;
  offsetY = 0;

  /** Three's renderer needs WebGL 2. */
  static supported(): boolean {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext(); // do not keep a context alive just for the probe
      return gl !== null;
    } catch {
      return false;
    }
  }

  constructor(private parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(1);
    this.gl.setSize(this.renderWidth, this.renderHeight, false);
    this.gl.setClearColor(FOG.color, 1);

    this.hudCanvas = document.createElement('canvas');
    this.hudCanvas.width = this.width;
    this.hudCanvas.height = this.height;
    parent.append(this.canvas, this.hudCanvas);

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, this.width / this.height, CAMERA.near, CAMERA.far);
    this.scene.add(this.camera);

    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  /** Size both canvases to the largest whole-aspect fit in the parent: the same CSS size and offset for both, whatever their buffer sizes. */
  fit(): void {
    const pw = this.parent.clientWidth || this.width;
    const ph = this.parent.clientHeight || this.height;
    const fit = Math.max(0.1, Math.min(pw / this.width, ph / this.height));
    // Whole device pixels per internal pixel keep the texture and dither even; take the loss of
    // screen only when it is small, so phones still fill their width.
    const dpr = window.devicePixelRatio || 1;
    const whole = Math.floor(fit * dpr) / dpr;
    const scale = whole >= 1 && whole / fit >= 0.85 ? whole : fit;
    const w = Math.floor(this.width * scale);
    const h = Math.floor(this.height * scale);
    this.cssScale = w / this.width;
    this.offsetX = Math.floor((pw - w) / 2);
    this.offsetY = Math.floor((ph - h) / 2);
    for (const c of [this.canvas, this.hudCanvas]) {
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.style.left = `${this.offsetX}px`;
      c.style.top = `${this.offsetY}px`;
    }
  }

  /** Client (CSS) coordinates to internal pixels. */
  toInternal(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.parent.getBoundingClientRect();
    return { x: (clientX - rect.left - this.offsetX) / this.cssScale, y: (clientY - rect.top - this.offsetY) / this.cssScale };
  }

  render(): void {
    this.gl.render(this.scene, this.camera);
  }
}

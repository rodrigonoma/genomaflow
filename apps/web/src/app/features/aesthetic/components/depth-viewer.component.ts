/**
 * DepthViewerComponent
 *
 * V2 Fase 3 F3.1: viewer Pseudo-3D heightmap via Three.js.
 *
 * Carrega foto (textura) + depth map (PNG grayscale) e renderiza um
 * PlaneGeometry com displacement vertical proporcional ao depth. Permite
 * rotação livre (clamp ±40° em F3.1, sem clamp em F3.2 multi-view).
 *
 * Three.js é lazy via `import('three')` — só carrega quando o
 * componente entra no DOM, evitando bloat do bundle principal.
 *
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase3-design.md §8.2
 */
import {
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-depth-viewer',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule],
  styles: [`
    :host { display: block; }
    .viewer-wrap {
      position: relative;
      width: 100%;
      max-width: 520px;
      aspect-ratio: 1 / 1;
      margin: 0 auto;
      border-radius: 12px;
      overflow: hidden;
      background: #0a0a14;
      border: 1px solid rgba(245, 158, 11, 0.25);
    }
    canvas {
      width: 100% !important;
      height: 100% !important;
      display: block;
      cursor: grab;
    }
    canvas:active { cursor: grabbing; }
    .loading-overlay,
    .error-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      color: #c0c1ff;
      font-size: 13px;
      background: rgba(10, 10, 20, 0.85);
    }
    .error-overlay { color: #ef4444; }
    .controls-hint {
      position: absolute;
      bottom: 0.5rem;
      left: 0.5rem;
      font-size: 10px;
      color: rgba(192, 193, 255, 0.7);
      pointer-events: none;
    }
  `],
  template: `
    <div class="viewer-wrap" data-testid="depth-viewer">
      <canvas #canvas></canvas>
      @if (loading()) {
        <div class="loading-overlay" data-testid="depth-viewer-loading">
          <mat-spinner diameter="32"></mat-spinner>
          <span>Carregando modelo 3D...</span>
        </div>
      }
      @if (error()) {
        <div class="error-overlay" data-testid="depth-viewer-error">
          <span>⚠ Falha ao carregar 3D</span>
          <small>{{ error() }}</small>
        </div>
      }
      @if (!loading() && !error()) {
        <div class="controls-hint">Arraste pra girar · scroll pra zoom</div>
      }
    </div>
  `,
})
export class DepthViewerComponent implements OnInit, OnDestroy {
  /** URL assinada do PNG depth map (heightmap mode). */
  @Input() depthUrl: string | null = null;
  /** URL assinada da textura (foto frontal — heightmap mode). */
  @Input() textureUrl: string | null = null;
  /** URL assinada do GLB binário (gltf mode — F3.2-B). */
  @Input() glbUrl: string | null = null;
  /** 'heightmap' (F3.1/F3.2-A) | 'gltf' (F3.2-B rotação 360°). */
  @Input() mode: 'heightmap' | 'gltf' = 'heightmap';

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private cleanup?: () => void;

  async ngOnInit(): Promise<void> {
    try {
      if (this.mode === 'gltf' && this.glbUrl) {
        await this._setupGltf();
      } else {
        if (!this.depthUrl || !this.textureUrl) {
          throw new Error('depthUrl + textureUrl obrigatórios para heightmap');
        }
        await this._setupHeightmap();
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Erro desconhecido');
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.cleanup?.();
  }

  // -------------------------------------------------------------------------
  // F3.1 heightmap pipeline
  // -------------------------------------------------------------------------

  private async _setupHeightmap(): Promise<void> {
    // Lazy load Three.js + OrbitControls
    const THREE = await import('three');
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');

    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 480;
    const height = rect.height || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a14);

    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    camera.position.set(0, 0, 2.5);

    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);

    // Iluminação básica
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(1, 1, 2);
    scene.add(dirLight);

    // Carregar textures em paralelo (null-check feito em ngOnInit)
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    const [textureMap, depthMap] = await Promise.all([
      this._loadTexture(loader, this.textureUrl!),
      this._loadTexture(loader, this.depthUrl!),
    ]);

    // Plano deformado: aspect 1:1 (depth e photo já square pelo worker pipeline)
    const segments = 256;
    const geometry = new THREE.PlaneGeometry(1.5, 1.5, segments, segments);
    const material = new THREE.MeshStandardMaterial({
      map: textureMap,
      displacementMap: depthMap,
      displacementScale: 0.35,
      displacementBias: -0.1,
      roughness: 0.8,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Controles — clamp ±40° em F3.1 (heightmap parece "papelão" se rotacionar muito)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = (Math.PI / 2) - (Math.PI / 4.5);  // ~50° pra cima
    controls.maxPolarAngle = (Math.PI / 2) + (Math.PI / 4.5);  // ~50° pra baixo
    controls.minAzimuthAngle = -Math.PI / 4.5;                  // ~40° esq
    controls.maxAzimuthAngle = Math.PI / 4.5;                   // ~40° dir
    controls.minDistance = 1.5;
    controls.maxDistance = 4;

    this.loading.set(false);

    // Render loop
    let rafId: number;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    animate();

    // Resize observer
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      const w = r.width || width;
      const h = r.height || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    });
    ro.observe(canvas);

    // Cleanup pra ngOnDestroy
    this.cleanup = () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      textureMap.dispose();
      depthMap.dispose();
      renderer.dispose();
    };
  }

  private _loadTexture(loader: import('three').TextureLoader, url: string): Promise<import('three').Texture> {
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (texture) => resolve(texture),
        undefined,
        (err) => reject(new Error(`Falha ao carregar imagem: ${err instanceof Error ? err.message : 'erro'}`)),
      );
    });
  }

  // -------------------------------------------------------------------------
  // F3.2-B GLTF pipeline — mesh real com rotação 360°
  // -------------------------------------------------------------------------

  private async _setupGltf(): Promise<void> {
    const THREE = await import('three');
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 480;
    const height = rect.height || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a14);

    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    camera.position.set(0, 0, 2.8);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);

    // Ilum mais rica pra mesh 3D
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(2, 2, 3);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
    fillLight.position.set(-2, 0, 1);
    scene.add(fillLight);

    // Load GLB
    const loader = new GLTFLoader();
    const gltf = await new Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF>(
      (resolve, reject) => {
        loader.load(
          this.glbUrl!,
          (data) => resolve(data),
          undefined,
          (err) => reject(new Error(`Falha ao carregar GLB: ${err instanceof Error ? err.message : 'erro'}`)),
        );
      },
    );

    const meshRoot = gltf.scene;
    // Habilitar both-sides na material principal pra evitar 'buracos' quando rotacionar
    meshRoot.traverse((obj) => {
      if ((obj as import('three').Mesh).isMesh) {
        const mesh = obj as import('three').Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (m && 'side' in m) {
            (m as import('three').Material & { side: number }).side = THREE.DoubleSide;
          }
        }
      }
    });
    scene.add(meshRoot);

    // F3.2-B: rotação 360° (sem clamp do heightmap)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.5;
    controls.maxDistance = 5;
    // sem minPolarAngle/maxPolarAngle/azimuthAngle clamp → rotação livre

    this.loading.set(false);

    let rafId: number;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      const w = r.width || width;
      const h = r.height || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    });
    ro.observe(canvas);

    this.cleanup = () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      // Dispose mesh resources recursively
      meshRoot.traverse((obj) => {
        if ((obj as import('three').Mesh).isMesh) {
          const m = obj as import('three').Mesh;
          if (m.geometry) m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            if (mat) {
              if ('map' in mat && mat.map) (mat as import('three').MeshStandardMaterial).map?.dispose();
              mat.dispose();
            }
          }
        }
      });
      renderer.dispose();
    };
  }
}

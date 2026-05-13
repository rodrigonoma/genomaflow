import { TestBed } from '@angular/core/testing';
import { CaptureValidatorService, Point3D } from './capture-validator.service';

function makePts(overrides: Record<number, Partial<Point3D>> = {}): Point3D[] {
  const pts: Point3D[] = Array(468).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [i, p] of Object.entries(overrides)) {
    pts[+i] = { ...pts[+i], ...p };
  }
  return pts;
}

function makeCanvas(width = 64, height = 64, fill = '#888'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  return c;
}

describe('CaptureValidatorService', () => {
  let svc: CaptureValidatorService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CaptureValidatorService] });
    svc = TestBed.inject(CaptureValidatorService);
  });

  // -------------------------------------------------------------------------
  // yawFromLandmarks
  // -------------------------------------------------------------------------

  describe('yawFromLandmarks', () => {
    it('olhos no mesmo Z → yaw ~0 (frontal)', () => {
      const pts = makePts({
        33: { x: 0.4, y: 0.5, z: 0 },
        263: { x: 0.6, y: 0.5, z: 0 },
      });
      const yaw = svc.yawFromLandmarks(pts);
      expect(Math.abs(yaw)).toBeLessThan(0.05);
    });

    it('olho direito recuado em Z → yaw positivo (cabeça girada pra direita)', () => {
      const pts = makePts({
        33: { x: 0.4, y: 0.5, z: 0 },
        263: { x: 0.6, y: 0.5, z: 0.2 },
      });
      const yaw = svc.yawFromLandmarks(pts);
      expect(yaw).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // eyeAspectRatio
  // -------------------------------------------------------------------------

  describe('eyeAspectRatio', () => {
    it('olho aberto (V altura razoável) → EAR > 0.2', () => {
      const pts = makePts({
        33:  { x: 0.40, y: 0.50, z: 0 },  // outer
        160: { x: 0.42, y: 0.48, z: 0 },  // top-outer
        158: { x: 0.46, y: 0.48, z: 0 },  // top-inner
        133: { x: 0.48, y: 0.50, z: 0 },  // inner
        153: { x: 0.46, y: 0.52, z: 0 },  // bottom-inner
        144: { x: 0.42, y: 0.52, z: 0 },  // bottom-outer
      });
      expect(svc.eyeAspectRatio(pts)).toBeGreaterThan(0.2);
    });

    it('olho fechado (V altura ~0) → EAR < 0.1', () => {
      const pts = makePts({
        33:  { x: 0.40, y: 0.50, z: 0 },
        160: { x: 0.42, y: 0.500, z: 0 },
        158: { x: 0.46, y: 0.500, z: 0 },
        133: { x: 0.48, y: 0.50, z: 0 },
        153: { x: 0.46, y: 0.501, z: 0 },
        144: { x: 0.42, y: 0.501, z: 0 },
      });
      expect(svc.eyeAspectRatio(pts)).toBeLessThan(0.1);
    });
  });

  // -------------------------------------------------------------------------
  // mouthAspectRatio
  // -------------------------------------------------------------------------

  describe('mouthAspectRatio', () => {
    it('boca fechada (lábios próximos) → MAR < 0.2', () => {
      const pts = makePts({
        13:  { x: 0.50, y: 0.61, z: 0 },
        14:  { x: 0.50, y: 0.62, z: 0 },
        78:  { x: 0.42, y: 0.615, z: 0 },
        308: { x: 0.58, y: 0.615, z: 0 },
      });
      expect(svc.mouthAspectRatio(pts)).toBeLessThan(0.2);
    });

    it('boca aberta (lábios afastados) → MAR > 0.4', () => {
      const pts = makePts({
        13:  { x: 0.50, y: 0.58, z: 0 },
        14:  { x: 0.50, y: 0.68, z: 0 },
        78:  { x: 0.42, y: 0.63, z: 0 },
        308: { x: 0.58, y: 0.63, z: 0 },
      });
      expect(svc.mouthAspectRatio(pts)).toBeGreaterThan(0.4);
    });
  });

  // -------------------------------------------------------------------------
  // centerFromLandmarks
  // -------------------------------------------------------------------------

  it('centerFromLandmarks media as coordenadas', () => {
    const pts = makePts();
    const { cx, cy } = svc.centerFromLandmarks(pts);
    expect(cx).toBeCloseTo(0.5, 5);
    expect(cy).toBeCloseTo(0.5, 5);
  });

  // -------------------------------------------------------------------------
  // histogramMean
  // -------------------------------------------------------------------------

  describe('histogramMean', () => {
    it('canvas cinza médio (#888 = 136) → ~136', () => {
      const c = makeCanvas(32, 32, '#888888');
      const v = svc.histogramMean(c);
      expect(v).toBeGreaterThan(125);
      expect(v).toBeLessThan(150);
    });

    it('canvas preto → ~0', () => {
      const c = makeCanvas(32, 32, '#000000');
      expect(svc.histogramMean(c)).toBeLessThan(10);
    });

    it('canvas branco → ~255', () => {
      const c = makeCanvas(32, 32, '#ffffff');
      expect(svc.histogramMean(c)).toBeGreaterThan(240);
    });
  });

  // -------------------------------------------------------------------------
  // laplacianVariance
  // -------------------------------------------------------------------------

  describe('laplacianVariance', () => {
    it('canvas uniforme → variance baixa (sem foco real, mas sem ruído também)', () => {
      const c = makeCanvas(32, 32, '#808080');
      expect(svc.laplacianVariance(c)).toBeLessThan(50);
    });

    it('canvas com bordas duras → variance maior', () => {
      const c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 16, 32);
      ctx.fillStyle = '#fff'; ctx.fillRect(16, 0, 16, 32);
      expect(svc.laplacianVariance(c)).toBeGreaterThan(500);
    });
  });

  // -------------------------------------------------------------------------
  // validateFace — composição das 6 heurísticas
  // -------------------------------------------------------------------------

  describe('validateFace', () => {
    it('frontal happy path → approved=true, score=1', () => {
      // Pose frontal (yaw ~0), olhos abertos, boca fechada, centralizado,
      // canvas com luminância média e bordas pra Laplacian.
      const pts = makePts({
        33:  { x: 0.40, y: 0.50, z: 0 },
        263: { x: 0.60, y: 0.50, z: 0 },
        160: { x: 0.42, y: 0.48, z: 0 },
        158: { x: 0.46, y: 0.48, z: 0 },
        133: { x: 0.48, y: 0.50, z: 0 },
        153: { x: 0.46, y: 0.52, z: 0 },
        144: { x: 0.42, y: 0.52, z: 0 },
        13:  { x: 0.50, y: 0.61, z: 0 },
        14:  { x: 0.50, y: 0.615, z: 0 },
        78:  { x: 0.45, y: 0.612, z: 0 },
        308: { x: 0.55, y: 0.612, z: 0 },
      });
      // Canvas com bordas e luminância média
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#404040'; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#a0a0a0'; ctx.fillRect(10, 10, 44, 44);

      const r = svc.validateFace(pts, c, 'frontal');
      expect(r.approved).toBe(true);
      expect(r.score).toBe(1);
    });

    it('canvas preto → reprovado por EXPOSURE', () => {
      const pts = makePts();
      const c = makeCanvas(32, 32, '#000');
      const r = svc.validateFace(pts, c, 'frontal');
      const expo = r.issues.find(i => i.code === 'EXPOSURE');
      expect(expo?.ok).toBe(false);
      expect(r.approved).toBe(false);
    });

    it('pose frontal mas yaw alto → reprovado por POSE', () => {
      // Olho direito muito mais "atrás" → grande yaw
      const pts = makePts({
        33:  { x: 0.40, y: 0.50, z: 0 },
        263: { x: 0.60, y: 0.50, z: 0.5 },
      });
      const c = makeCanvas();
      const r = svc.validateFace(pts, c, 'frontal');
      const pose = r.issues.find(i => i.code === 'POSE');
      expect(pose?.ok).toBe(false);
    });

    it('expected=profile_left + yaw ~0 → reprovado POSE', () => {
      const pts = makePts({
        33:  { x: 0.40, y: 0.50, z: 0 },
        263: { x: 0.60, y: 0.50, z: 0 },
      });
      const c = makeCanvas();
      const r = svc.validateFace(pts, c, 'profile_left');
      expect(r.issues.find(i => i.code === 'POSE')?.ok).toBe(false);
    });
  });
});

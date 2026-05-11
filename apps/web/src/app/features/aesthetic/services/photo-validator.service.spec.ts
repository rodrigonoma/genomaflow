import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { PhotoValidatorService } from './photo-validator.service';

// ---------------------------------------------------------------------------
// Helpers to create mock File + mock browser APIs
// ---------------------------------------------------------------------------

/**
 * Builds a minimal File object with controlled size and MIME type.
 * We do NOT set actual image bytes — the service reads them via
 * Image / canvas, which we mock below.
 */
function makeFile(opts: {
  name?: string;
  sizeMB?: number;
  type?: string;
}): File {
  const { name = 'photo.jpg', sizeMB = 1, type = 'image/jpeg' } = opts;
  // Fill with zeros of the desired byte size (no real image data needed)
  const bytes = new Uint8Array(sizeMB * 1024 * 1024);
  return new File([bytes], name, { type });
}

// jsdom does not implement URL.createObjectURL / revokeObjectURL — stub them.
if (typeof URL.createObjectURL === 'undefined') {
  Object.defineProperty(URL, 'createObjectURL', {
    value: (_blob: Blob) => 'blob:mock-object-url',
    writable: true,
  });
}
if (typeof URL.revokeObjectURL === 'undefined') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: (_url: string) => {},
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('PhotoValidatorService', () => {
  let service: PhotoValidatorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PhotoValidatorService);
  });

  // -----------------------------------------------------------------------
  // Test 1: Photo OK — valid JPEG, 2 MB, 2048×2048 → valid: true
  // -----------------------------------------------------------------------
  it('deve retornar valid:true para foto JPEG grande e nítida', async () => {
    const file = makeFile({ sizeMB: 2, type: 'image/jpeg' });

    // Stub the Image load so it reports 2048×2048
    const origImage = (global as any).Image;
    (global as any).Image = class {
      naturalWidth = 2048;
      naturalHeight = 2048;
      onload: (() => void) | null = null;
      set src(_val: string) {
        // Trigger onload asynchronously (same tick via Promise)
        Promise.resolve().then(() => this.onload && this.onload());
      }
    };

    // Stub canvas Laplacian to report "sharp"
    const origCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => {},
            getImageData: () => ({ data: new Uint8ClampedArray(4 * 100 * 100).fill(200) }),
            filter: '',
          }),
        } as unknown as HTMLCanvasElement;
      }
      return origCreateElement(tag);
    });

    const result = await service.validate(file);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();

    (global as any).Image = origImage;
    jest.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Test 2: File too large — 8 MB → valid: false, error mentions 8MB + 5MB
  // -----------------------------------------------------------------------
  it('deve retornar valid:false para arquivo de 8MB (máx 5MB)', async () => {
    const file = makeFile({ sizeMB: 8, type: 'image/jpeg' });

    const result = await service.validate(file);

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/8.*MB/i);
    expect(result.error).toMatch(/5MB/i);
  });

  // -----------------------------------------------------------------------
  // Test 3: Invalid MIME — image/webp → valid: false, error mentions mime
  // -----------------------------------------------------------------------
  it('deve retornar valid:false para MIME inválido (image/webp)', async () => {
    const file = makeFile({ sizeMB: 1, type: 'image/webp' });

    const result = await service.validate(file);

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/image\/webp/);
    expect(result.error).toMatch(/JPEG|PNG/i);
  });

  // -----------------------------------------------------------------------
  // Test 4: Low resolution — 640×480 → valid: false, error mentions 640×480
  // -----------------------------------------------------------------------
  it('deve retornar valid:false para resolução baixa (640×480)', async () => {
    const file = makeFile({ sizeMB: 0.5, type: 'image/jpeg' });

    const origImage = (global as any).Image;
    (global as any).Image = class {
      naturalWidth = 640;
      naturalHeight = 480;
      onload: (() => void) | null = null;
      set src(_val: string) {
        Promise.resolve().then(() => this.onload && this.onload());
      }
    };

    const result = await service.validate(file);

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/640/);
    expect(result.error).toMatch(/480/);
    expect(result.error).toMatch(/1024/);

    (global as any).Image = origImage;
  });
});

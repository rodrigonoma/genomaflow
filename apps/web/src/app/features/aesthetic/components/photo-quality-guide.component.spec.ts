import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { PhotoQualityGuideComponent } from './photo-quality-guide.component';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock FileList.
 * jsdom does not implement DataTransfer, so we build the interface manually.
 */
function makeMockFileList(files: File[]): FileList {
  const fileList = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () { yield* files; },
  } as unknown as FileList;
  files.forEach((f, i) => {
    Object.defineProperty(fileList, i, { value: f });
  });
  return fileList;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('PhotoQualityGuideComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PhotoQualityGuideComponent],
    }).compileComponents();
  });

  // -------------------------------------------------------------------------
  // Test 1: Renders orientation list with key items
  // -------------------------------------------------------------------------
  it('renderiza lista de orientações com itens chave', () => {
    const fixture = TestBed.createComponent(PhotoQualityGuideComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    // Key orientation phrases that must appear in the template
    const text = el.textContent ?? '';
    expect(text).toContain('frontal');
    // case-insensitive check for "Iluminação"
    expect(text.toLowerCase()).toContain('ilumina');
    expect(text).toContain('1024');
    expect(text.toLowerCase()).toContain('fundo neutro');
    expect(text.toLowerCase()).toContain('maquiagem');
  });

  // -------------------------------------------------------------------------
  // Test 2: Emits photosSelected when files are chosen
  // -------------------------------------------------------------------------
  it('emite photosSelected ao selecionar arquivos', () => {
    const fixture = TestBed.createComponent(PhotoQualityGuideComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    const emitted: File[][] = [];
    comp.photosSelected.subscribe((files: File[]) => emitted.push(files));

    const file1 = new File(['a'], 'photo1.jpg', { type: 'image/jpeg' });
    const file2 = new File(['b'], 'photo2.jpg', { type: 'image/jpeg' });
    const mockFileList = makeMockFileList([file1, file2]);

    // Simulate the change event from the hidden input
    comp.onFilesChange(mockFileList);

    expect(emitted.length).toBe(1);
    expect(emitted[0]).toHaveLength(2);
    expect(emitted[0][0].name).toBe('photo1.jpg');
    expect(emitted[0][1].name).toBe('photo2.jpg');
  });

  // -------------------------------------------------------------------------
  // Test 3: Renders region-specific orientations for legs
  // -------------------------------------------------------------------------
  it('renderiza orientações específicas pra region=legs', () => {
    const fixture = TestBed.createComponent(PhotoQualityGuideComponent);
    fixture.componentRef.setInput('region', 'legs');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).toContain('Coxas');
    expect(text).toContain('Roupa íntima');
  });

  // -------------------------------------------------------------------------
  // Test 4: Renders ⚠️ warning for sensitive region (breast)
  // -------------------------------------------------------------------------
  it('renderiza ⚠️ pra região sensível (breast)', () => {
    const fixture = TestBed.createComponent(PhotoQualityGuideComponent);
    fixture.componentRef.setInput('region', 'breast');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).toContain('⚠️');
    expect(text).toContain('consentimento');
  });
});

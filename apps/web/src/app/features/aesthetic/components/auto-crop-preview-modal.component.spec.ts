/**
 * Spec: AutoCropPreviewModalComponent
 * Tests: renderiza 2 imagens + botões; fechar emite resultados corretos.
 */
import '@angular/compiler';
import { TestBed, fakeAsync, flush } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { HttpHeaders, HttpResponse } from '@angular/common/http';
import {
  AutoCropPreviewModalComponent,
  AutoCropPreviewModalData,
  AutoCropPreviewModalResult,
} from './auto-crop-preview-modal.component';
import { AestheticFacialService } from '../services/aesthetic-facial.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDialogRef = { close: jest.fn() };

const blurredBlob = new Blob(['fake-blurred'], { type: 'image/jpeg' });

const mockFacialService = {
  previewBlur: jest.fn(),
};

const MODAL_DATA: AutoCropPreviewModalData = {
  originalFile: new File(['fake-original'], 'photo.jpg', { type: 'image/jpeg' }),
  subjectId: 'sub-uuid-001',
};

// jsdom does not implement URL.createObjectURL — stub it
global.URL.createObjectURL = jest.fn(() => 'blob:fake-url');
global.URL.revokeObjectURL = jest.fn();

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

async function setupModule(previewBlurImpl?: () => unknown) {
  jest.clearAllMocks();

  const defaultResponse = new HttpResponse<Blob>({
    body: blurredBlob,
    status: 200,
    headers: new HttpHeaders({
      'x-auto-crop-applied': '2',
      'x-auto-crop-regions': '2',
    }),
  });

  mockFacialService.previewBlur.mockReturnValue(
    previewBlurImpl ? of(previewBlurImpl()) : of(defaultResponse),
  );

  await TestBed.configureTestingModule({
    imports: [AutoCropPreviewModalComponent, NoopAnimationsModule],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: MODAL_DATA },
      { provide: MatDialogRef, useValue: mockDialogRef },
      { provide: AestheticFacialService, useValue: mockFacialService },
    ],
  }).compileComponents();
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('AutoCropPreviewModalComponent', () => {

  // -------------------------------------------------------------------------
  // Test 1: renderiza 2 painéis de imagem + 3 botões quando preview carrega
  // -------------------------------------------------------------------------
  it('exibe 2 imagens (original + blurred) e 3 botões de ação após load', async () => {
    await setupModule();

    const fixture = TestBed.createComponent(AutoCropPreviewModalComponent);
    const comp = fixture.componentInstance;

    // Trigger ngOnInit (async)
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    // loading deve ter ido a false
    expect(comp.loading()).toBe(false);
    expect(comp.errorMsg()).toBeNull();

    // URLs de imagem devem ter sido definidas
    expect(comp.originalUrl()).toBeTruthy();
    expect(comp.blurredUrl()).toBeTruthy();

    // Verifica que createObjectURL foi chamado pelo menos para original + blurred
    expect(URL.createObjectURL).toHaveBeenCalledWith(MODAL_DATA.originalFile);
    expect(URL.createObjectURL).toHaveBeenCalledWith(blurredBlob);

    const compiled: HTMLElement = fixture.nativeElement;

    // Deve haver exatamente 2 tags <img>
    const imgs = compiled.querySelectorAll('img');
    expect(imgs.length).toBe(2);

    // Deve haver ao menos 3 botões
    const buttons = compiled.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  // -------------------------------------------------------------------------
  // Test 2: botões emitem resultados corretos ao fechar
  // -------------------------------------------------------------------------
  it('aceitar com blur chama dialogRef.close({ confirmed: true, autoCrop: true })', async () => {
    await setupModule();

    const fixture = TestBed.createComponent(AutoCropPreviewModalComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    fixture.componentInstance.acceptWithBlur();
    expect(mockDialogRef.close).toHaveBeenCalledWith({ confirmed: true, autoCrop: true } as AutoCropPreviewModalResult);
  });

  it('aceitar sem blur chama dialogRef.close({ confirmed: true, autoCrop: false })', async () => {
    await setupModule();

    const fixture = TestBed.createComponent(AutoCropPreviewModalComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    fixture.componentInstance.acceptWithoutBlur();
    expect(mockDialogRef.close).toHaveBeenCalledWith({ confirmed: true, autoCrop: false } as AutoCropPreviewModalResult);
  });

  it('cancelar chama dialogRef.close({ confirmed: false })', async () => {
    await setupModule();

    const fixture = TestBed.createComponent(AutoCropPreviewModalComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    fixture.componentInstance.cancel();
    expect(mockDialogRef.close).toHaveBeenCalledWith({ confirmed: false } as AutoCropPreviewModalResult);
  });
});

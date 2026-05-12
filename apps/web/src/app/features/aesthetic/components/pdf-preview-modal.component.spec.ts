/**
 * PdfPreviewModalComponent — unit tests
 *
 * Testa:
 *  1. Renderiza iframe quando blob carrega (mock HttpClient retorna Blob + URL.createObjectURL)
 *  2. Error path mostra mensagem quando HTTP falha
 *  3. Click "Baixar" cria anchor com download attr correto e o remove
 *  4. ngOnDestroy chama URL.revokeObjectURL com a blob URL gerada
 *  5. filename customizado é usado no download
 */
import '@angular/compiler';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { PdfPreviewModalComponent, PdfPreviewModalData } from './pdf-preview-modal.component';

// jsdom does not implement URL.createObjectURL / revokeObjectURL — stub globally
global.URL.createObjectURL = jest.fn(() => 'blob:fake-url');
global.URL.revokeObjectURL = jest.fn();

// ---------------------------------------------------------------------------
// Per-test setup (matches auto-crop-preview-modal pattern — no fakeAsync)
// ---------------------------------------------------------------------------

async function setupModule(data: PdfPreviewModalData): Promise<{
  fixture: ComponentFixture<PdfPreviewModalComponent>;
  comp: PdfPreviewModalComponent;
  httpMock: HttpTestingController;
  dialogRefMock: { close: jest.Mock };
}> {
  jest.clearAllMocks();

  const dialogRefMock = { close: jest.fn() };

  await TestBed.configureTestingModule({
    imports: [PdfPreviewModalComponent, HttpClientTestingModule, NoopAnimationsModule],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: dialogRefMock },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(PdfPreviewModalComponent);
  const comp = fixture.componentInstance;
  const httpMock = TestBed.inject(HttpTestingController);
  fixture.detectChanges();

  return { fixture, comp, httpMock, dialogRefMock };
}

/** Helper: flush a successful blob response and re-run change detection. */
function flushBlob(
  httpMock: HttpTestingController,
  fixture: ComponentFixture<PdfPreviewModalComponent>,
  urlSnippet: string,
): void {
  const req = httpMock.expectOne(r => r.url.includes(urlSnippet) && r.responseType === 'blob');
  req.flush(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
  fixture.detectChanges();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PdfPreviewModalComponent', () => {

  // -------------------------------------------------------------------------
  // Test 1: Renderiza iframe quando blob carrega
  // -------------------------------------------------------------------------
  it('renderiza iframe quando o blob é retornado com sucesso', async () => {
    const { fixture, comp, httpMock } = await setupModule({ analysisId: 'ana-001' });

    // Initially loading
    expect(comp.loading()).toBe(true);
    expect(comp.pdfUrl()).toBeNull();

    flushBlob(httpMock, fixture, '/aesthetic/analyses/ana-001/export.pdf');

    expect(comp.loading()).toBe(false);
    expect(comp.error()).toBeNull();
    expect(comp.pdfUrl()).toBe('blob:fake-url');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    const iframe = (fixture.nativeElement as HTMLElement).querySelector('iframe.pdf-frame');
    expect(iframe).not.toBeNull();

    httpMock.verify();
  });

  // -------------------------------------------------------------------------
  // Test 2: Error path mostra mensagem quando HTTP falha
  // -------------------------------------------------------------------------
  it('exibe mensagem de erro quando a requisição HTTP falha', async () => {
    const { fixture, comp, httpMock } = await setupModule({ analysisId: 'ana-002' });

    const req = httpMock.expectOne(r =>
      r.url.includes('/aesthetic/analyses/ana-002/export.pdf')
    );
    req.error(new ErrorEvent('network error'));
    fixture.detectChanges();

    expect(comp.loading()).toBe(false);
    expect(comp.pdfUrl()).toBeNull();

    const el = fixture.nativeElement as HTMLElement;
    const errorDiv = el.querySelector('.error');
    expect(errorDiv).not.toBeNull();
    expect(el.querySelector('iframe')).toBeNull();

    httpMock.verify();
  });

  // -------------------------------------------------------------------------
  // Test 3: Click "Baixar" cria anchor com download attr correto
  // -------------------------------------------------------------------------
  it('click em "Baixar" cria anchor com atributo download = analise-{id}.pdf e o remove', async () => {
    const { fixture, comp, httpMock } = await setupModule({ analysisId: 'ana-003' });

    flushBlob(httpMock, fixture, '/aesthetic/analyses/ana-003/export.pdf');

    const mockAnchor = { href: '', download: '', click: jest.fn() };
    const createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
    const appendSpy = jest.spyOn(document.body, 'appendChild').mockImplementation((node: any) => node);
    const removeSpy = jest.spyOn(document.body, 'removeChild').mockImplementation((node: any) => node);

    comp.download();

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(mockAnchor.href).toBe('blob:fake-url');
    expect(mockAnchor.download).toBe('analise-ana-003.pdf');
    expect(mockAnchor.click).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledWith(mockAnchor);
    expect(removeSpy).toHaveBeenCalledWith(mockAnchor);

    createElementSpy.mockRestore();
    appendSpy.mockRestore();
    removeSpy.mockRestore();

    httpMock.verify();
  });

  // -------------------------------------------------------------------------
  // Test 4: ngOnDestroy chama URL.revokeObjectURL
  // -------------------------------------------------------------------------
  it('ngOnDestroy chama URL.revokeObjectURL com a blob URL gerada', async () => {
    const { fixture, comp, httpMock } = await setupModule({ analysisId: 'ana-004' });

    flushBlob(httpMock, fixture, '/aesthetic/analyses/ana-004/export.pdf');

    expect(comp.pdfUrl()).toBe('blob:fake-url');

    // Call ngOnDestroy directly to test the revoke
    comp.ngOnDestroy();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');

    httpMock.verify();
  });

  // -------------------------------------------------------------------------
  // Test 5: filename customizado é usado no download
  // -------------------------------------------------------------------------
  it('usa filename customizado quando fornecido no data', async () => {
    const { fixture, comp, httpMock } = await setupModule({
      analysisId: 'ana-005',
      filename: 'protocolo-personalizado.pdf',
    });

    flushBlob(httpMock, fixture, '/aesthetic/analyses/ana-005/export.pdf');

    const mockAnchor = { href: '', download: '', click: jest.fn() };
    const createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
    jest.spyOn(document.body, 'appendChild').mockImplementation((node: any) => node);
    jest.spyOn(document.body, 'removeChild').mockImplementation((node: any) => node);

    comp.download();

    expect(mockAnchor.download).toBe('protocolo-personalizado.pdf');

    createElementSpy.mockRestore();

    httpMock.verify();
  });
});

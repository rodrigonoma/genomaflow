import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PhotoUploaderComponent } from './photo-uploader.component';
import { PhotoValidatorService, ValidationResult } from '../services/photo-validator.service';
import { AestheticFacialService } from '../services/aesthetic-facial.service';
import { AestheticPhoto } from '../models/analysis.model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File(['fake-image-content'], name, { type });
}

function makePhotoResponse(id: string): AestheticPhoto {
  return {
    id,
    tenant_id: 'tenant-uuid',
    subject_id: 'subject-uuid',
    user_id: 'user-uuid',
    photo_type: 'facial_front',
    s3_key: `uploads/${id}.jpg`,
    is_sensitive: false,
    taken_at: '2026-05-11T10:00:00Z',
    notes: null,
    deleted_at: null,
    created_at: '2026-05-11T10:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('PhotoUploaderComponent', () => {
  let validatorMock: { validate: jest.Mock };
  let facialServiceMock: { uploadPhoto: jest.Mock };

  beforeEach(async () => {
    validatorMock = { validate: jest.fn() };
    facialServiceMock = { uploadPhoto: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [PhotoUploaderComponent],
      providers: [
        { provide: PhotoValidatorService, useValue: validatorMock },
        { provide: AestheticFacialService, useValue: facialServiceMock },
      ],
    }).compileComponents();
  });

  // -------------------------------------------------------------------------
  // Test 1: Validation success → calls upload, emits uploadComplete
  // -------------------------------------------------------------------------
  it('arquivo válido: chama upload e emite uploadComplete com photo_ids', async () => {
    const fixture = TestBed.createComponent(PhotoUploaderComponent);
    const comp = fixture.componentInstance;

    comp.subjectId = 'subject-uuid';
    comp.photoType = 'facial_front';

    const okResult: ValidationResult = { valid: true };
    validatorMock.validate.mockResolvedValue(okResult);

    const photoResp = makePhotoResponse('photo-id-001');
    facialServiceMock.uploadPhoto.mockReturnValue(of(photoResp));

    const completedIds: string[][] = [];
    comp.uploadComplete.subscribe((ids: string[]) => completedIds.push(ids));

    const file = makeFile();
    comp.files.set([file]);
    await comp.startUpload();

    expect(validatorMock.validate).toHaveBeenCalledWith(file);
    expect(facialServiceMock.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(completedIds).toHaveLength(1);
    expect(completedIds[0]).toEqual(['photo-id-001']);
  });

  // -------------------------------------------------------------------------
  // Test 2: Validation rejection → emit uploadError, does NOT call upload
  // -------------------------------------------------------------------------
  it('arquivo inválido: emite uploadError e NÃO chama upload', async () => {
    const fixture = TestBed.createComponent(PhotoUploaderComponent);
    const comp = fixture.componentInstance;

    comp.subjectId = 'subject-uuid';
    comp.photoType = 'facial_front';

    const rejResult: ValidationResult = {
      valid: false,
      error: 'Formato não suportado',
    };
    validatorMock.validate.mockResolvedValue(rejResult);

    const errors: Array<{ file: string; error: string }> = [];
    comp.uploadError.subscribe((e: { file: string; error: string }) => errors.push(e));

    const completedIds: string[][] = [];
    comp.uploadComplete.subscribe((ids: string[]) => completedIds.push(ids));

    const file = makeFile('bad.bmp', 'image/bmp');
    comp.files.set([file]);
    await comp.startUpload();

    expect(facialServiceMock.uploadPhoto).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe('bad.bmp');
    expect(errors[0].error).toContain('Formato');
    // uploadComplete still emits with empty array (no successful uploads)
    expect(completedIds).toHaveLength(1);
    expect(completedIds[0]).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Test 3: Multiple files: 1 OK + 1 invalid → upload only OK, 1 error emitted
  // -------------------------------------------------------------------------
  it('múltiplos arquivos: faz upload do válido e emite error do inválido', async () => {
    const fixture = TestBed.createComponent(PhotoUploaderComponent);
    const comp = fixture.componentInstance;

    comp.subjectId = 'subject-uuid';
    comp.photoType = 'facial_front';

    const okResult: ValidationResult = { valid: true };
    const badResult: ValidationResult = { valid: false, error: 'Resolução baixa' };

    // First call: ok, second call: bad
    validatorMock.validate
      .mockResolvedValueOnce(okResult)
      .mockResolvedValueOnce(badResult);

    const photoResp = makePhotoResponse('photo-id-002');
    facialServiceMock.uploadPhoto.mockReturnValue(of(photoResp));

    const completedIds: string[][] = [];
    comp.uploadComplete.subscribe((ids: string[]) => completedIds.push(ids));

    const errors: Array<{ file: string; error: string }> = [];
    comp.uploadError.subscribe((e: { file: string; error: string }) => errors.push(e));

    const goodFile = makeFile('good.jpg');
    const badFile = makeFile('bad.jpg');
    comp.files.set([goodFile, badFile]);
    await comp.startUpload();

    expect(facialServiceMock.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe('bad.jpg');
    expect(completedIds).toHaveLength(1);
    expect(completedIds[0]).toEqual(['photo-id-002']);
  });

  // -------------------------------------------------------------------------
  // Test 4: Empty array → nothing triggered
  // -------------------------------------------------------------------------
  it('array vazio: não dispara validação nem upload', async () => {
    const fixture = TestBed.createComponent(PhotoUploaderComponent);
    const comp = fixture.componentInstance;

    comp.subjectId = 'subject-uuid';
    comp.photoType = 'facial_front';

    const completedIds: string[][] = [];
    comp.uploadComplete.subscribe((ids: string[]) => completedIds.push(ids));

    const errors: Array<{ file: string; error: string }> = [];
    comp.uploadError.subscribe((e: { file: string; error: string }) => errors.push(e));

    comp.files.set([]);
    await comp.startUpload();

    expect(validatorMock.validate).not.toHaveBeenCalled();
    expect(facialServiceMock.uploadPhoto).not.toHaveBeenCalled();
    expect(errors).toHaveLength(0);
    // No uploadComplete emitted for empty (nothing to process)
    expect(completedIds).toHaveLength(0);
  });
});

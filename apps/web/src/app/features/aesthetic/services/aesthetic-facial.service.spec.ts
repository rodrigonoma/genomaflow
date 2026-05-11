import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { AestheticFacialService } from './aesthetic-facial.service';
import { AestheticConsent, AestheticAnalysisDetail, CompareResult } from '../models/analysis.model';

describe('AestheticFacialService', () => {
  let service: AestheticFacialService;
  let httpMock: HttpTestingController;

  const BASE = '/api/aesthetic';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AestheticFacialService],
    });
    service = TestBed.inject(AestheticFacialService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // -------------------------------------------------------------------------
  // Test 1: getConsent faz GET para /api/aesthetic/consent/:subjectId
  // -------------------------------------------------------------------------
  it('getConsent faz GET em /aesthetic/consent/:subjectId', () => {
    const subjectId = 'sub-uuid-001';
    const mockResponse: AestheticConsent = {
      id: 'consent-uuid-001',
      tenant_id: 'tenant-uuid-001',
      subject_id: subjectId,
      user_id: 'user-uuid-001',
      consented_at: '2026-05-11T10:00:00Z',
      notes: null,
      reinforced_regions: null,
      revoked_at: null,
      created_at: '2026-05-11T10:00:00Z',
    };

    service.getConsent(subjectId).subscribe((result) => {
      expect(result).toEqual(mockResponse);
    });

    const req = httpMock.expectOne(`${BASE}/consent/${subjectId}`);
    expect(req.request.method).toBe('GET');
    req.flush(mockResponse);
  });

  // -------------------------------------------------------------------------
  // Test 2: createAnalysis faz POST com payload completo
  // -------------------------------------------------------------------------
  it('createAnalysis faz POST com payload em /aesthetic/analyses', () => {
    const payload = {
      analysis_type: 'facial' as const,
      subject_id: 'sub-uuid-001',
      photo_ids: ['photo-uuid-001', 'photo-uuid-002'],
    };

    const mockResponse: AestheticAnalysisDetail = {
      id: 'analysis-uuid-001',
      tenant_id: 'tenant-uuid-001',
      subject_id: payload.subject_id,
      user_id: 'user-uuid-001',
      analysis_type: 'facial',
      photo_ids: payload.photo_ids,
      status: 'pending',
      metrics: null,
      observations: null,
      recommendations: null,
      model_metrics: null,
      model_recommendations: null,
      tokens_input: null,
      tokens_output: null,
      error_code: null,
      error_message: null,
      baseline_analysis_id: null,
      credits_charged: 5,
      credits_refunded: false,
      deleted_at: null,
      created_at: '2026-05-11T10:00:00Z',
      completed_at: null,
    };

    service.createAnalysis(payload).subscribe((result) => {
      expect(result).toEqual(mockResponse);
      expect(result.analysis_type).toBe('facial');
      expect(result.status).toBe('pending');
    });

    const req = httpMock.expectOne(`${BASE}/analyses`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush(mockResponse);
  });

  // -------------------------------------------------------------------------
  // Test 3: compareAnalyses faz POST com baseline_id no body
  // -------------------------------------------------------------------------
  it('compareAnalyses faz POST com baseline_id em /aesthetic/analyses/:id/compare', () => {
    const currentId = 'analysis-uuid-002';
    const baselineId = 'analysis-uuid-001';

    const mockResponse: CompareResult = {
      baseline_id: baselineId,
      current_id: currentId,
      deltas: {
        symmetry: 0.05,
        skin_texture: -0.02,
      },
      overall_change: 0.03,
    };

    service.compareAnalyses(currentId, baselineId).subscribe((result) => {
      expect(result).toEqual(mockResponse);
      expect(result.baseline_id).toBe(baselineId);
      expect(result.current_id).toBe(currentId);
      expect(result.overall_change).toBe(0.03);
    });

    const req = httpMock.expectOne(`${BASE}/analyses/${currentId}/compare`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ baseline_id: baselineId });
    req.flush(mockResponse);
  });
});

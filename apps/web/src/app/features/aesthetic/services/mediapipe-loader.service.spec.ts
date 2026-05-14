import { TestBed } from '@angular/core/testing';
import { MediaPipeLoaderService } from './mediapipe-loader.service';

// Mock @mediapipe/tasks-vision para evitar download de WASM real nos tests
jest.mock('@mediapipe/tasks-vision', () => {
  const mockFaceLandmarker = { detectForVideo: jest.fn(() => ({ faceLandmarks: [] })) };
  const mockPoseLandmarker = { detectForVideo: jest.fn(() => ({ landmarks: [] })) };
  return {
    FaceLandmarker: {
      createFromOptions: jest.fn(async () => mockFaceLandmarker),
    },
    PoseLandmarker: {
      createFromOptions: jest.fn(async () => mockPoseLandmarker),
    },
    FilesetResolver: {
      forVisionTasks: jest.fn(async () => ({})),
    },
  };
});

describe('MediaPipeLoaderService', () => {
  let service: MediaPipeLoaderService;

  beforeEach(() => {
    // Reset contadores dos mocks entre testes — sem isso, asserts
    // `.toHaveBeenCalledTimes(1)` somam chamadas de testes anteriores e
    // falham com `Received: 2` (Test 1 chamou createFromOptions 1x, Test 3
    // chama mais 1x, counter total = 2). Localmente passa quando os testes
    // rodam isolados; no CI todos rodam em sequência no mesmo arquivo.
    jest.clearAllMocks();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [MediaPipeLoaderService] });
    service = TestBed.inject(MediaPipeLoaderService);
  });

  it('versão exposta para audit em landmarks.provider_version', () => {
    expect(service.version).toBe('0.10.35');
  });

  it('getFaceLandmarker carrega FaceLandmarker e cacheia', async () => {
    const lm1 = await service.getFaceLandmarker();
    const lm2 = await service.getFaceLandmarker();
    expect(lm1).toBe(lm2);
    const lib = require('@mediapipe/tasks-vision');
    expect(lib.FaceLandmarker.createFromOptions).toHaveBeenCalledTimes(1);
  });

  it('getPoseLandmarker carrega PoseLandmarker e cacheia', async () => {
    const lm1 = await service.getPoseLandmarker();
    const lm2 = await service.getPoseLandmarker();
    expect(lm1).toBe(lm2);
    const lib = require('@mediapipe/tasks-vision');
    expect(lib.PoseLandmarker.createFromOptions).toHaveBeenCalledTimes(1);
  });

  it('single-flight: 2 chamadas concorrentes retornam a mesma Promise', async () => {
    const [lm1, lm2] = await Promise.all([
      service.getFaceLandmarker(),
      service.getFaceLandmarker(),
    ]);
    expect(lm1).toBe(lm2);
    const lib = require('@mediapipe/tasks-vision');
    expect(lib.FaceLandmarker.createFromOptions).toHaveBeenCalledTimes(1);
  });

  it('loading signal vira true durante carga e false após', async () => {
    expect(service.loading()).toBe(false);
    const promise = service.getFaceLandmarker();
    expect(service.loading()).toBe(true);
    await promise;
    expect(service.loading()).toBe(false);
  });

  it('face e pose landmarkers são independentes', async () => {
    const face = await service.getFaceLandmarker();
    const pose = await service.getPoseLandmarker();
    expect(face).not.toBe(pose);
  });
});

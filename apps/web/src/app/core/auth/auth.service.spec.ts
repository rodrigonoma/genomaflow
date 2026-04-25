import '@angular/compiler';
import { of } from 'rxjs';
import { AuthService } from './auth.service';

// Fake JWT: header.payload.sig — payload = { user_id, tenant_id, role }
const fakeToken = 'x.' + btoa(JSON.stringify({
  user_id: 'u1', tenant_id: 't1', role: 'doctor'
})) + '.sig';

describe('AuthService', () => {
  let service: AuthService;
  let mockWs: any;
  let mockRouter: any;
  let mockHttp: any;

  beforeEach(() => {
    localStorage.clear();
    mockWs = { connect: jest.fn(), disconnect: jest.fn() };
    mockRouter = { navigate: jest.fn() };
    mockHttp = {
      post: jest.fn(() => of({ token: fakeToken })),
      // /auth/me chamado por fetchProfile após login pra hidratar profile —
      // retorna observable vazio pra não quebrar o pipeline do tap
      get: jest.fn(() => of({ tenant_name: 'Clínica X', module: 'human' })),
    };

    // Instantiate service with mocked dependencies
    service = new AuthService(mockHttp, mockRouter, mockWs);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('currentUser is null when no token in storage', () => {
    expect(service.currentUser).toBeNull();
  });

  it('login stores token and emits currentUser', (done) => {
    service.login('doc@clinic.com', 'pass123').subscribe(() => {
      expect(service.currentUser?.role).toBe('doctor');
      expect(localStorage.getItem('token')).toBe(fakeToken);
      done();
    });
  });

  it('logout clears token and currentUser', (done) => {
    service.login('doc@clinic.com', 'pass123').subscribe(() => {
      service.logout();
      expect(service.currentUser).toBeNull();
      expect(localStorage.getItem('token')).toBeNull();
      done();
    });
  });
});

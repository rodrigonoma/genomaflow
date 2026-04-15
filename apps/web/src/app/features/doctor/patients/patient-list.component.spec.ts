import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { PatientListComponent } from './patient-list.component';
import { AuthService } from '../../../core/auth/auth.service';
import { WsService } from '../../../core/ws/ws.service';

const mockAuth = { getToken: () => 'tok', logout: jest.fn(), currentUser: { role: 'doctor' }, currentUser$: { subscribe: jest.fn() } };
const mockWs = { connect: jest.fn(), disconnect: jest.fn(), examUpdates$: { pipe: jest.fn(() => ({ subscribe: jest.fn() })) } };

describe('PatientListComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PatientListComponent, RouterTestingModule, HttpClientTestingModule, BrowserAnimationsModule],
      providers: [
        { provide: AuthService, useValue: mockAuth },
        { provide: WsService, useValue: mockWs }
      ]
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads patients on init', () => {
    const fixture = TestBed.createComponent(PatientListComponent);
    fixture.detectChanges();
    const req = http.expectOne(`/api/patients`);
    req.flush([{ id: '1', name: 'João', sex: 'M', birth_date: '1980-01-01', created_at: '' }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('João');
  });
});

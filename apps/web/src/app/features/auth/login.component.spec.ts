import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth/auth.service';

const mockAuth = {
  login: jest.fn(),
  currentUser: null,
  currentUser$: of(null)
};

describe('LoginComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoginComponent, RouterTestingModule],
      providers: [{ provide: AuthService, useValue: mockAuth }]
    });
  });

  it('calls auth.login with form values', () => {
    mockAuth.login.mockReturnValue(of(undefined));
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;
    component.email = 'doc@clinic.com';
    component.password = 'pass';
    component.submit();
    expect(mockAuth.login).toHaveBeenCalledWith('doc@clinic.com', 'pass');
  });

  it('sets error message on login failure', (done) => {
    mockAuth.login.mockReturnValue(throwError(() => ({ status: 401 })));
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;
    component.email = 'x';
    component.password = 'y';
    component.submit();
    setTimeout(() => {
      expect(component.error).toBeTruthy();
      done();
    }, 0);
  });
});

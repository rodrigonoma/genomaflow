import '@angular/compiler';
import { TestBed, NO_ERRORS_SCHEMA } from '@angular/core/testing';
import { AlertBadgeComponent } from './alert-badge.component';

describe('AlertBadgeComponent', () => {
  it('renders severity label', () => {
    TestBed.configureTestingModule({
      imports: [AlertBadgeComponent],
      schemas: [NO_ERRORS_SCHEMA]
    });
    const fixture = TestBed.createComponent(AlertBadgeComponent);
    fixture.componentInstance.severity = 'critical';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('critical');
  });
});

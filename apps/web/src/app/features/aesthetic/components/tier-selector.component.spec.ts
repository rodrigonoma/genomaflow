import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TierSelectorComponent } from './tier-selector.component';
import { By } from '@angular/platform-browser';

describe('TierSelectorComponent', () => {
  let fixture: ComponentFixture<TierSelectorComponent>;
  let component: TierSelectorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TierSelectorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TierSelectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renderiza ambos os cards com custos default 5/10', () => {
    const std = fixture.debugElement.query(By.css('[data-testid=tier-card-standard]'));
    const adv = fixture.debugElement.query(By.css('[data-testid=tier-card-advanced]'));
    expect(std).toBeTruthy();
    expect(adv).toBeTruthy();

    const stdText = std.nativeElement.textContent;
    const advText = adv.nativeElement.textContent;
    expect(stdText).toContain('5');
    expect(advText).toContain('10');
  });

  it('badge PRECISÃO aparece SÓ no card advanced', () => {
    const adv = fixture.debugElement.query(By.css('[data-testid=tier-card-advanced]'));
    const std = fixture.debugElement.query(By.css('[data-testid=tier-card-standard]'));
    expect(adv.nativeElement.textContent).toContain('PRECISÃO');
    expect(std.nativeElement.textContent).not.toContain('PRECISÃO');
  });

  it('aceita custos custom via @Input', () => {
    component.standardCost = 3;
    component.advancedCost = 15;
    fixture.detectChanges();
    const std = fixture.debugElement.query(By.css('[data-testid=tier-card-standard]')).nativeElement;
    const adv = fixture.debugElement.query(By.css('[data-testid=tier-card-advanced]')).nativeElement;
    expect(std.textContent).toContain('3');
    expect(adv.textContent).toContain('15');
  });

  it('click no card standard emite tierSelected=standard', (done) => {
    component.tierSelected.subscribe((tier) => {
      expect(tier).toBe('standard');
      done();
    });
    const std = fixture.debugElement.query(By.css('[data-testid=tier-card-standard]'));
    std.nativeElement.click();
  });

  it('click no card advanced emite tierSelected=advanced', (done) => {
    component.tierSelected.subscribe((tier) => {
      expect(tier).toBe('advanced');
      done();
    });
    const adv = fixture.debugElement.query(By.css('[data-testid=tier-card-advanced]'));
    adv.nativeElement.click();
  });

  it('keyboard Enter no card emite tierSelected', (done) => {
    component.tierSelected.subscribe((tier) => {
      expect(tier).toBe('advanced');
      done();
    });
    const adv = fixture.debugElement.query(By.css('[data-testid=tier-card-advanced]'));
    adv.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  });
});

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { RegionPickerComponent } from './region-picker.component';

describe('RegionPickerComponent', () => {
  let fixture: ComponentFixture<RegionPickerComponent>;
  let component: RegionPickerComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegionPickerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RegionPickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renderiza 10 region cards', () => {
    const el: HTMLElement = fixture.nativeElement;
    const cards = el.querySelectorAll('[data-testid="region-card"]');
    expect(cards.length).toBe(10);
  });

  it('click em card emite regionSelected com region key', () => {
    const emitted: string[] = [];
    component.regionSelected.subscribe((r) => emitted.push(r));
    const el: HTMLElement = fixture.nativeElement;
    const firstCard = el.querySelector('[data-testid="region-card"][data-region="facial"]') as HTMLElement;
    firstCard.click();
    expect(emitted).toEqual(['facial']);
  });

  it('cards renderizam label PT-BR', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Facial');
    expect(el.textContent).toContain('Coxas');
    expect(el.textContent).toContain('Glúteos');
  });
});

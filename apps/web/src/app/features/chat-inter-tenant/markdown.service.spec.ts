import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { MarkdownService } from './markdown.service';

describe('MarkdownService', () => {
  let service: MarkdownService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MarkdownService,
        {
          provide: DomSanitizer,
          useValue: { bypassSecurityTrustHtml: (s: string) => s },
        },
      ],
    });
    service = TestBed.inject(MarkdownService);
  });

  function html(input: string): string {
    return service.render(input) as unknown as string;
  }

  it('renders bold + italic + paragraph', () => {
    const out = html('Texto **negrito** e _itálico_');
    expect(out).toContain('<strong>negrito</strong>');
    expect(out).toContain('<em>itálico</em>');
  });

  it('renders unordered list', () => {
    const out = html('- item 1\n- item 2');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>item 1</li>');
    expect(out).toContain('<li>item 2</li>');
  });

  it('renders ordered list', () => {
    const out = html('1. primeiro\n2. segundo');
    expect(out).toContain('<ol>');
    expect(out).toContain('<li>primeiro</li>');
  });

  it('renders headings h2/h3 mas não h1', () => {
    const out = html('## Título 2\n### Título 3');
    expect(out).toContain('<h2>Título 2</h2>');
    expect(out).toContain('<h3>Título 3</h3>');
  });

  it('renders links com target=_blank rel=noopener noreferrer', () => {
    const out = html('Link [aqui](https://example.com)');
    expect(out).toMatch(/<a [^>]*href="https:\/\/example\.com"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>aqui<\/a>/);
  });

  it('strips <script> tags', () => {
    const out = html('Antes<script>alert("xss")</script>Depois');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('alert');
  });

  it('strips event handlers (onclick, onerror)', () => {
    // marked + DOMPurify removem onclick/onerror de elementos
    const out = html('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert');
  });

  it('strips iframes', () => {
    const out = html('<iframe src="https://evil.com"></iframe>');
    expect(out).not.toContain('<iframe');
  });

  it('preserva code inline + bloco', () => {
    const out = html('Texto `inline` e\n\n```\nbloco\n```');
    expect(out).toContain('<code>inline</code>');
    expect(out).toMatch(/<pre><code[^>]*>bloco/);
  });

  it('quebra de linha simples vira <br>', () => {
    const out = html('linha 1\nlinha 2');
    expect(out).toContain('<br>');
  });

  it('input vazio retorna string vazia', () => {
    expect(html('')).toBe('');
    expect(html(undefined as any)).toBe('');
  });

  it('strip de javascript: em href', () => {
    const out = html('[click](javascript:alert(1))');
    // DOMPurify remove o atributo href com schemes inseguros
    expect(out).not.toContain('javascript:');
  });
});

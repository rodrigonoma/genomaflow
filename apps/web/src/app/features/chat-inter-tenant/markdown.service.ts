import { Injectable, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Render markdown sanitizado com whitelist explícita de tags/atributos.
 *
 * Usado APENAS pra mensagens onde sender é master tenant (canal
 * "Administrador GenomaFlow"). Mensagens normais de tenants ficam como
 * texto puro — markdown só pra remetente confiável.
 *
 * Whitelist conservadora — sem <iframe>, <script>, event handlers, ou
 * estilos inline. Links forçam rel="noopener noreferrer" e target="_blank".
 */
@Injectable({ providedIn: 'root' })
export class MarkdownService {
  private sanitizer = inject(DomSanitizer);

  private readonly ALLOWED_TAGS = [
    'p', 'br',
    'strong', 'em', 'b', 'i',
    'ul', 'ol', 'li',
    'h2', 'h3', 'h4',
    'a',
    'code', 'pre',
    'blockquote',
    'hr',
  ];

  private readonly ALLOWED_ATTR = ['href', 'rel', 'target'];

  render(body: string): SafeHtml {
    if (!body) return this.sanitizer.bypassSecurityTrustHtml('');

    // marked sync mode (não usar await — manter pipeline render-on-tick)
    const html = marked.parse(body, {
      breaks: true,    // \n vira <br>
      gfm: true,
      async: false,
    }) as string;

    const clean = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: this.ALLOWED_TAGS,
      ALLOWED_ATTR: this.ALLOWED_ATTR,
      ADD_ATTR: ['target', 'rel'],
    });

    // Garante que todo <a> abre em nova aba com rel seguro (DOMPurify
    // preserva o que já existe no markdown — e marked não seta target)
    const withSafeLinks = clean.replace(
      /<a\s+([^>]*?)href="([^"]+)"([^>]*?)>/gi,
      (_match, pre, href, post) =>
        `<a ${pre}href="${href}" target="_blank" rel="noopener noreferrer"${post}>`
    );

    return this.sanitizer.bypassSecurityTrustHtml(withSafeLinks);
  }
}

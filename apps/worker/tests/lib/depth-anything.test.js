'use strict';

const { describe, test, expect } = require('@jest/globals');
const { generateDepthMap, PROVIDER_VERSION, DEPTH_WIDTH, DEPTH_HEIGHT } =
  require('../../src/lib/depth-anything');

describe('depth-anything (F3.1 MVP mock)', () => {
  test('PROVIDER_VERSION expõe versão do provider (audit)', () => {
    expect(typeof PROVIDER_VERSION).toBe('string');
    expect(PROVIDER_VERSION).toMatch(/mock|depth-anything/);
  });

  test('dimensões default 512x512', () => {
    expect(DEPTH_WIDTH).toBe(512);
    expect(DEPTH_HEIGHT).toBe(512);
  });

  test('generateDepthMap retorna PNG buffer não-vazio', async () => {
    const photoBuffer = Buffer.from('fake-jpeg-bytes');
    const result = await generateDepthMap(photoBuffer);

    expect(result.depthPng).toBeInstanceOf(Buffer);
    expect(result.depthPng.length).toBeGreaterThan(100);  // PNG válido
    // Magic bytes PNG: \x89 PNG
    expect(result.depthPng[0]).toBe(0x89);
    expect(result.depthPng[1]).toBe(0x50);
    expect(result.depthPng[2]).toBe(0x4E);
    expect(result.depthPng[3]).toBe(0x47);
  });

  test('result inclui width/height/providerVersion/processingMs', async () => {
    const result = await generateDepthMap(Buffer.alloc(10));
    expect(result.width).toBe(DEPTH_WIDTH);
    expect(result.height).toBe(DEPTH_HEIGHT);
    expect(result.providerVersion).toBe(PROVIDER_VERSION);
    expect(typeof result.processingMs).toBe('number');
    expect(result.processingMs).toBeGreaterThanOrEqual(0);
  });
});

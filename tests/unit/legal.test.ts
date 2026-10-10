/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COPYRIGHT, EULA, eulaPlainText } from '../../src/legal/eula';

const FILE = new URL('../../build/eula.txt', import.meta.url);

describe('license agreement', () => {
  it('carries the copyright notice', () => {
    expect(COPYRIGHT).toBe('© 2026 Marios Kouretis. All rights reserved.');
    expect(EULA.at(-1)!.paragraphs.join(' ')).toContain(COPYRIGHT);
  });

  it('installer copy (build/eula.txt) matches the in-app agreement', () => {
    // Regenerate with: UPDATE_EULA=1 npx vitest run tests/unit/legal.test.ts
    if (process.env.UPDATE_EULA) writeFileSync(FILE, eulaPlainText());
    const text = readFileSync(FILE, 'utf8');
    expect(text).toBe(eulaPlainText());
    expect(/^[\x00-\x7f]*$/.test(text)).toBe(true);
  });
});

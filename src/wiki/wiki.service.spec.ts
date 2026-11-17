import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { loadWiki, WIKI_DIR, WikiService } from './wiki.service.js';

describe('loadWiki', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wiki-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('puts the README first as "home", then follows its link order', () => {
    writeFileSync(join(dir, 'README.md'), '# Wiki\n[B](b.md) and [A](a.md#part) and [B again](b.md)');
    writeFileSync(join(dir, 'a.md'), '# Alpha page\ntext');
    writeFileSync(join(dir, 'b.md'), 'intro\n\n# Beta page');
    writeFileSync(join(dir, 'z-unlinked.md'), 'no heading');
    writeFileSync(join(dir, 'notes.txt'), 'ignored');

    const pages = loadWiki(dir);
    expect(pages.map((p) => [p.slug, p.title])).toEqual([
      ['home', 'Wiki'],
      ['b', 'Beta page'],
      ['a', 'Alpha page'],
      ['z-unlinked', 'z-unlinked'],
    ]);
  });

  it('returns no pages when the folder is missing', () => {
    expect(loadWiki(join(dir, 'missing'))).toEqual([]);
  });
});

describe('WikiService', () => {
  it('serves the real docs/wiki-docs pages', () => {
    const wiki = new WikiService();
    const slugs = wiki.list().map((p) => p.slug);
    expect(slugs[0]).toBe('home');
    expect(slugs).toContain('managing-workers');
    expect(wiki.get('managing-workers').markdown).toContain('# Managing workers');
    expect(WIKI_DIR.endsWith(join('docs', 'wiki-docs'))).toBe(true);
  });

  it('404s for unknown slugs, including path tricks', () => {
    const wiki = new WikiService();
    expect(() => wiki.get('nope')).toThrow(NotFoundException);
    expect(() => wiki.get('../README')).toThrow(NotFoundException);
  });
});

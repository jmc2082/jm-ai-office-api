import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// docs/ sits at the project root, next to src/ and dist/ (copied into the image too).
export const WIKI_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/wiki-docs',
);

/** The wiki's README is served as the home page. */
export const HOME_SLUG = 'home';
const HOME_FILE = 'README.md';

export interface WikiPageSummary {
  slug: string;
  title: string;
}

export interface WikiPage extends WikiPageSummary {
  markdown: string;
}

/**
 * Serves docs/wiki-docs/*.md to the dashboard. Pages are read once at startup, so
 * they change with each deploy. Order follows the links in the wiki README, then
 * any page it doesn't link, alphabetically.
 */
@Injectable()
export class WikiService {
  private readonly logger = new Logger(WikiService.name);
  private readonly pages: WikiPage[];

  constructor() {
    this.pages = loadWiki(WIKI_DIR);
    this.logger.log(`Wiki: ${this.pages.length} pages from ${WIKI_DIR}`);
  }

  list(): WikiPageSummary[] {
    return this.pages.map(({ slug, title }) => ({ slug, title }));
  }

  get(slug: string): WikiPage {
    const page = this.pages.find((p) => p.slug === slug);
    if (!page) throw new NotFoundException(`No wiki page "${slug}"`);
    return page;
  }
}

export function loadWiki(dir: string): WikiPage[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const read = (file: string) => readFileSync(join(dir, file), 'utf8');

  const linked = files.includes(HOME_FILE)
    ? [...read(HOME_FILE).matchAll(/\]\(([\w.-]+\.md)(?:#[^)]*)?\)/g)].map((m) => m[1])
    : [];
  const order = [
    ...(files.includes(HOME_FILE) ? [HOME_FILE] : []),
    ...linked.filter((f, i) => files.includes(f) && linked.indexOf(f) === i),
    ...files.filter((f) => f !== HOME_FILE && !linked.includes(f)).sort(),
  ];

  return order.map((file) => {
    const markdown = read(file);
    const slug = file === HOME_FILE ? HOME_SLUG : file.replace(/\.md$/, '');
    const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
    return { slug, title: heading ?? slug, markdown };
  });
}

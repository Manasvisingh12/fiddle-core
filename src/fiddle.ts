import * as fs from 'fs-extra';
import * as path from 'path';
import debug from 'debug';
import simpleGit from 'simple-git';
import { createHash } from 'crypto';

import { DefaultPaths } from './paths';

function hashString(str: string): string {
  const md5sum = createHash('md5');
  md5sum.update(str);
  return md5sum.digest('hex');
}

export class Fiddle {
  constructor(
    public readonly mainPath: string, // /path/to/main.js
    public readonly source: string,
  ) {}

  public remove(): Promise<void> {
    return fs.remove(path.dirname(this.mainPath));
  }
}

/**
 * - Iterable<string, string> - filename-to-content key/value pairs
 * - string of form '/path/to/fiddle' - a fiddle on the filesystem
 * - string of form 'https://github.com/my/repo.git' - a git repo fiddle
 * - string of form '642fa8daaebea6044c9079e3f8a46390' - a github gist fiddle
 */
export type FiddleSource = Fiddle | string | Iterable<[string, string]>;

export class FiddleFactory {
  constructor(private readonly fiddles: string = DefaultPaths.fiddles) {}

  public async fromGist(gistId: string): Promise<Fiddle> {
    return this.fromRepo(`https://gist.github.com/${gistId}.git`);
  }

  public async fromFolder(source: string): Promise<Fiddle> {
    const d = debug('fiddle-runner:FiddleFactory:fromFolder');

    // make a tmp copy of this fiddle
    const folder = path.join(this.fiddles, hashString(source));
    d({ source, folder });
    await fs.remove(folder);
    await fs.copy(source, folder);

    return new Fiddle(path.join(folder, 'main.js'), source);
  }

  public async fromRepo(url: string, checkout = 'master'): Promise<Fiddle> {
    const d = debug('fiddle-runner:FiddleFactory:fromRepo');
    const folder = path.join(this.fiddles, hashString(url));
    d({ url, checkout, folder });

    // get the repo
    if (!fs.existsSync(folder)) {
      d(`cloning "${url}" into "${folder}"`);
      const git = simpleGit();
      await git.clone(url, folder);
    }

    const git = simpleGit(folder);
    await git.checkout(checkout);
    await git.pull('origin', checkout);

    return new Fiddle(path.join(folder, 'main.js'), url);
  }

  public async fromEntries(src: Iterable<[string, string]>): Promise<Fiddle> {
    const d = debug('fiddle-runner:FiddleFactory:fromMem');
    const map = new Map<string, string>(src);

    // make a name for the directory that will hold our temp copy of the fiddle
    const md5sum = createHash('md5');
    for (const content of map.values()) md5sum.update(content);
    const hash = md5sum.digest('hex');
    const folder = path.join(this.fiddles, hash);
    d({ folder });

    // save content to that temp directory
    await Promise.all(
      [...map.entries()].map(([filename, content]) =>
        fs.outputFile(path.join(folder, filename), content, 'utf8'),
      ),
    );

    return new Fiddle(path.join(folder, 'main.js'), 'entries');
  }

  public async create(src: FiddleSource): Promise<Fiddle | undefined> {
    if (src instanceof Fiddle) return src;

    if (typeof src === 'string') {
      if (fs.existsSync(src)) return this.fromFolder(src);
      if (/^[0-9A-Fa-f]{32}$/.test(src)) return this.fromGist(src);
      if (/^https:/.test(src) || /\.git$/.test(src)) return this.fromRepo(src);
      return;
    }

    return this.fromEntries(src);
  }
}

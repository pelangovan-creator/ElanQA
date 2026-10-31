import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';

/** Local-disk storage for originals and evidence. Paths are always generated server-side. */
@Injectable()
export class StorageService {
  readonly root = resolve(process.env.STORAGE_DIR ?? './storage');

  static safeName(name: string): string {
    const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const base = basename(name, extname(name)).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'file';
    return `${base}${ext}`;
  }

  static sha256(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
  }

  /** Store bytes unchanged; returns the path relative to the storage root. */
  async put(parts: string[], fileName: string, data: Buffer): Promise<string> {
    const dir = join(...parts.map((p) => p.replace(/[^A-Za-z0-9_-]/g, '')), randomUUID());
    await mkdir(join(this.root, dir), { recursive: true });
    const rel = join(dir, StorageService.safeName(fileName));
    await writeFile(join(this.root, rel), data, { flag: 'wx' });
    return rel;
  }

  private abs(rel: string): string {
    const p = resolve(this.root, rel);
    if (!p.startsWith(this.root + sep)) throw new NotFoundException('Invalid storage path');
    return p;
  }

  async get(rel: string): Promise<Buffer> {
    try {
      return await readFile(this.abs(rel));
    } catch {
      throw new NotFoundException('File not found in storage');
    }
  }

  async exists(rel: string): Promise<boolean> {
    return stat(this.abs(rel)).then(() => true, () => false);
  }
}

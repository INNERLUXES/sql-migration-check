// Reading the migration files. A file is read whole, and only when it is a regular file under the size limit; the size is
// taken from the open file, so it cannot change between the check and the read. A folder is read one level deep: its
// .sql files, in name order. Nothing is written, and no file is opened that was not named or found in a named folder.

import { open, readdir, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const FILE_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxFiles: 5000
};

// An error with the path in its message and the reason alone in .reason, so a caller can show its own path.
export function fileError(path, reason) {
  return Object.assign(new Error(`${path}: ${reason}`), { reason });
}

function megabytes(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toLocaleString('en-US')} MB` : `${bytes.toLocaleString('en-US')} bytes`;
}

// The whole file, or an error when it is not a regular file or is over the limit. The path was given by the person who
// runs the tool, so a symbolic link in it is followed; a pipe or a device is never opened, because opening one can block.
export async function readBounded(path, maxBytes = FILE_LIMITS.maxFileBytes) {
  let info;
  try {
    info = await stat(resolve(path));
  } catch (error) {
    if (error.code === 'ENOENT') throw fileError(path, 'no such file');
    throw fileError(path, `cannot be read (${error.code ?? error.message})`);
  }
  if (info.isDirectory()) throw fileError(path, 'a folder, not a file');
  if (!info.isFile()) throw fileError(path, 'not a regular file');
  let handle;
  try {
    handle = await open(resolve(path), 'r');
  } catch (error) {
    if (error.code === 'ENOENT') throw fileError(path, 'no such file');
    throw fileError(path, `cannot be read (${error.code ?? error.message})`);
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw fileError(path, 'not a regular file');
    if (opened.size > maxBytes) throw fileError(path, `${opened.size.toLocaleString('en-US')} bytes is over the ${megabytes(maxBytes)} limit`);
    const buffer = Buffer.alloc(opened.size);
    let read = 0;
    while (read < opened.size) {
      const { bytesRead } = await handle.read(buffer, read, opened.size - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return buffer.subarray(0, read);
  } finally {
    await handle.close();
  }
}

function toPosix(path) {
  return sep === '/' ? path : path.split(sep).join('/');
}

// A path as shown in a report: relative to the base folder with forward slashes; a path outside it is shown absolute,
// also with forward slashes.
export function displayPath(path, base) {
  const rel = relative(base, path);
  if (rel === '') return '.';
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return toPosix(path);
  return toPosix(rel);
}

// Names compared by code unit, so the order is the same on every system and in every locale.
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The files to read, as absolute paths in the order they are applied: for each argument in the order given, the file
// itself, or the .sql files of the folder in name order. Returns { files, skipped, duplicates }; skipped counts the
// entries of a folder that were not regular .sql files.
export async function collectFiles(args, base, limits = FILE_LIMITS) {
  const files = [];
  const seen = new Set();
  let skipped = 0;
  let duplicates = 0;
  const add = (full) => {
    if (seen.has(full)) {
      duplicates += 1;
      return;
    }
    seen.add(full);
    files.push(full);
    if (files.length > limits.maxFiles) throw new Error(`more than ${limits.maxFiles.toLocaleString('en-US')} files; the limit protects the run, split the set`);
  };
  for (const arg of args) {
    const full = resolve(base, arg);
    let info;
    try {
      info = await stat(full);
    } catch (error) {
      if (error.code === 'ENOENT') throw fileError(displayPath(full, base), 'no such file or folder');
      throw fileError(displayPath(full, base), `cannot be read (${error.code ?? error.message})`);
    }
    if (!info.isDirectory()) {
      add(full);
      continue;
    }
    let entries;
    try {
      entries = await readdir(full);
    } catch (error) {
      throw fileError(displayPath(full, base), `cannot be listed (${error.code ?? error.message})`);
    }
    const names = entries.filter((name) => name.toLowerCase().endsWith('.sql')).sort(compare);
    skipped += entries.length - names.length;
    let found = 0;
    for (const name of names) {
      const path = resolve(full, name);
      let entry;
      try {
        entry = await stat(path);
      } catch {
        skipped += 1;
        continue;
      }
      if (!entry.isFile()) {
        skipped += 1;
        continue;
      }
      found += 1;
      add(path);
    }
    if (found === 0) throw fileError(displayPath(full, base), 'no .sql file in this folder');
  }
  return { files, skipped, duplicates };
}

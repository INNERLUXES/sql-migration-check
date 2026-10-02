import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { FILE_LIMITS, collectFiles, displayPath, fileError, readBounded } from '../src/index.js';
import { withFiles } from './helpers.js';

test('files: the limits are 5 MB a file, 50 MB in all and 5,000 files', () => {
  assert.deepEqual(FILE_LIMITS, { maxFileBytes: 5 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024, maxFiles: 5000 });
});

test('files: fileError puts the path in the message and the reason alone in .reason', () => {
  const error = fileError('db/a.sql', 'no such file');
  assert.equal(error.message, 'db/a.sql: no such file');
  assert.equal(error.reason, 'no such file');
});

test('files: readBounded reads a regular file whole and refuses a folder, a missing file and a file over the limit', async () => {
  await withFiles({ 'a.sql': 'SELECT 1;\n', 'dir/b.sql': 'x' }, async (dir) => {
    assert.equal((await readBounded(resolve(dir, 'a.sql'))).toString('utf8'), 'SELECT 1;\n');
    await assert.rejects(readBounded(resolve(dir, 'dir')), /a folder, not a file/);
    await assert.rejects(readBounded(resolve(dir, 'missing.sql')), /no such file/);
    await assert.rejects(readBounded(resolve(dir, 'a.sql'), 5), /10 bytes is over the 5 bytes limit/);
  });
});

test('files: displayPath is relative with forward slashes inside the base folder and absolute outside it', async () => {
  await withFiles({ 'db/a.sql': 'x' }, async (dir) => {
    assert.equal(displayPath(resolve(dir, 'db/a.sql'), dir), 'db/a.sql');
    assert.equal(displayPath(dir, dir), '.');
    const outside = displayPath(resolve(dir, 'db/a.sql'), resolve(dir, 'db'));
    assert.equal(outside, 'a.sql');
    const up = displayPath(resolve(dir, 'db/a.sql'), resolve(dir, 'other'));
    assert.ok(!up.includes('\\'));
    assert.ok(up.endsWith('/db/a.sql'));
  });
});

test('files: collectFiles sorts a folder by code unit, keeps the order of the arguments and counts what it skipped', async () => {
  await withFiles({ 'db/b.sql': 'x', 'db/Z.sql': 'x', 'db/a.sql': 'x', 'db/notes.md': 'x', 'one.sql': 'x' }, async (dir) => {
    const { files, skipped, duplicates } = await collectFiles(['one.sql', 'db', 'one.sql'], dir);
    assert.deepEqual(files.map((f) => f.slice(dir.length + 1).split('\\').join('/')), ['one.sql', 'db/Z.sql', 'db/a.sql', 'db/b.sql']);
    assert.equal(skipped, 1);
    assert.equal(duplicates, 1);
    await assert.rejects(collectFiles(['nope'], dir), /nope: no such file or folder/);
  });
});

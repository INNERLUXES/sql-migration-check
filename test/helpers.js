// Shared test helpers: migrations written inline, and files written into a temporary folder that is removed after the
// test.

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { checkTexts, main } from '../src/index.js';

export async function withFiles(files, fn) {
  const dir = await mkdtemp(resolve(tmpdir(), 'sql-migration-check-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(resolve(dir, rel)), { recursive: true });
      await writeFile(resolve(dir, rel), content);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Checks one migration written inline.
export function check(sql, options = {}) {
  return checkTexts([{ path: options.name ?? 'm.sql', text: sql }], options);
}

// Checks several migrations: an object of name -> text, applied in the order of the keys.
export function checkSet(files, options = {}) {
  return checkTexts(Object.entries(files).map(([path, text]) => ({ path, text })), options);
}

export const ids = (report) => report.findings.map((f) => f.id);
export const find = (report, id) => report.findings.filter((f) => f.id === id);

// Writes the files and runs the command line with these arguments (paths relative to the folder).
export async function run(files, args = [], limits) {
  return withFiles(files, async (dir) => {
    let out = '';
    let err = '';
    const code = await main(args, { out: (t) => { out += t; }, err: (t) => { err += t; } }, limits, dir);
    return { code, out, err };
  });
}

// Runs the command line with exactly these arguments.
export async function cli(argv) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } });
  return { code, out, err };
}

// A table that exists before the migration under test: the first file of the set is read for its table names only.
export const EXISTING = 'CREATE TABLE visits (id bigint PRIMARY KEY, patient_id bigint, notes text, email text, starts_at timestamptz);\nCREATE TABLE patients (id bigint PRIMARY KEY, email text);\n';

// Checks a migration against the tables of EXISTING, which are existing tables and not new ones.
export function afterExisting(sql, options = {}) {
  return checkSet({ '001_base.sql': EXISTING, '002_change.sql': sql }, { since: '002_change.sql', ...options });
}

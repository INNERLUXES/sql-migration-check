// Command line: sql-migration-check <file-or-folder>... [options]

import { readFileSync } from 'node:fs';
import { FINDINGS, LIMITS, checkFiles } from './check.js';
import { MANUAL_BASE } from './data.js';
import { safeText } from './rules.js';
import { toText, toMarkdown, toJson, toCsv } from './report.js';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const FORMATS = { text: toText, markdown: toMarkdown, json: toJson, csv: toCsv };
const THRESHOLDS = ['error', 'warning'];

export const USAGE = `Usage: sql-migration-check <file-or-folder>... [options]

Reads PostgreSQL migration files and reports the statements that can lock a table, lose data or break running
application code during a deploy. A folder gives its .sql files in name order; files are read in the order given.
Every finding quotes the PostgreSQL manual (${MANUAL_BASE}). It never prints row data,
connects to no database, opens no network connection and runs no program.

Options:
  --format <name>     text, markdown, json or csv (default: text)
  --fail-on <level>   exit with 1 when a finding is at this level or above: error or warning
                      (default: error); info never fails the run
  --since <file>      the first migration that is still to be applied; the files before it are read only to learn
                      which tables exist, and nothing in them is reported
  --help              show this text
  --version           show the version

Tables created earlier in the same set are new tables and get no lock or data findings; use --since when the
earlier migrations have already run.

Checks: ${FINDINGS.map((f) => f.id).join(', ')}

Exit codes: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
`;

export function parseArgs(argv) {
  const o = { inputs: [], format: 'text', failOn: 'error', since: null, help: false, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--format') o.format = next();
    else if (a === '--fail-on') o.failOn = next();
    else if (a === '--since') o.since = next();
    else if (a === '-') throw new Error('reading from standard input is not supported; give the path of a file or a folder');
    else if (a.startsWith('-')) throw new Error(`unknown argument ${a}`);
    else o.inputs.push(a);
  }
  if (!o.help && !o.version) {
    if (o.inputs.length === 0) throw new Error('give the path of a migration file or of a folder of .sql files');
    for (const input of o.inputs) if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) throw new Error('give a local path; the tool never fetches a URL');
    if (!Object.hasOwn(FORMATS, o.format)) throw new Error(`unknown format ${o.format} (text, markdown, json or csv)`);
    if (!THRESHOLDS.includes(o.failOn)) throw new Error(`--fail-on takes error or warning, not ${o.failOn}`);
  }
  return o;
}

const clean = (text) => safeText(text, 1000);

// Exit code: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
export async function main(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }, limits = LIMITS, base = process.cwd()) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (error) {
    io.err(`sql-migration-check: ${clean(error.message)}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    io.out(USAGE);
    return 0;
  }
  if (o.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  let report;
  try {
    report = await checkFiles(o.inputs, { failOn: o.failOn, since: o.since, version: VERSION, limits, base });
  } catch (error) {
    io.err(`sql-migration-check: ${clean(error.message)}\n`);
    return 2;
  }
  io.out(FORMATS[o.format](report));
  return report.gate.pass ? 0 : 1;
}

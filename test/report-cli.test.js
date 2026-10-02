import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { check, cli, run, withFiles } from './helpers.js';
import { USAGE, VERSION, csvCell, mdCell, parseArgs, toCsv, toJson, toMarkdown, toText } from '../src/index.js';

const RISKY = 'DROP TABLE visits;\nCREATE INDEX a ON visits (id);\nALTER TABLE visits VALIDATE CONSTRAINT k;\n';

test('exit codes: 0 without a finding at the level, 1 with one, 2 for a usage or input error', async () => {
  assert.equal((await run({ 'm.sql': 'SELECT 1;\n' }, ['m.sql'])).code, 0);
  assert.equal((await run({ 'm.sql': RISKY }, ['m.sql'])).code, 1);
  assert.equal((await run({ 'm.sql': RISKY }, [])).code, 2);
  assert.equal((await run({}, ['missing.sql'])).code, 2);
});

test('--fail-on: warnings fail only at the level warning, and info never fails', async () => {
  const warn = 'CREATE INDEX a ON visits (id);\n';
  assert.equal((await run({ 'm.sql': warn }, ['m.sql'])).code, 0);
  assert.equal((await run({ 'm.sql': warn }, ['m.sql', '--fail-on', 'warning'])).code, 1);
  const info = 'ALTER TABLE visits VALIDATE CONSTRAINT k;\n';
  const r = await run({ 'm.sql': info }, ['m.sql', '--fail-on', 'warning']);
  assert.equal(r.code, 0);
  assert.match(r.out, /INFO {5}validate-constraint/);
  assert.match(r.out, /GATE: PASS \(--fail-on warning\)/);
  assert.equal((await run({ 'm.sql': info }, ['m.sql', '--fail-on', 'info'])).code, 2);
});

test('arguments: unknown options, missing values, bad formats and addresses are usage errors that print the usage', async () => {
  for (const argv of [['--nope'], ['m.sql', '--format'], ['m.sql', '--format', 'xml'], ['https://example.test/m.sql'], ['-'], ['m.sql', '--fail-on', '--format']]) {
    const r = await cli(argv);
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.err, /Usage: sql-migration-check/);
    assert.equal(r.out, '');
  }
  assert.throws(() => parseArgs(['--since']), /needs a value/);
});

test('arguments: --help and --version print and exit 0, and the usage lists the checks and the exit codes', async () => {
  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  assert.equal(help.out, USAGE);
  assert.match(USAGE, /index-not-concurrent/);
  assert.match(USAGE, /Exit codes: 0 no finding/);
  const version = await cli(['--version']);
  assert.equal(version.out, `${VERSION}\n`);
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test('input: a folder gives its .sql files in name order, other entries are ignored and counted', async () => {
  const r = await run({ 'db/010_b.sql': 'DROP TABLE b;\n', 'db/002_a.sql': 'DROP TABLE a;\n', 'db/readme.txt': 'DROP TABLE x;\n', 'db/UPPER.SQL': 'DROP TABLE u;\n' }, ['db', '--format', 'json']);
  const report = JSON.parse(r.out);
  assert.deepEqual(report.input.files.map((f) => f.path), ['db/002_a.sql', 'db/010_b.sql', 'db/UPPER.SQL']);
  assert.deepEqual(report.findings.map((f) => f.table), ['a', 'b', 'u']);
  assert.match(report.notes.join('\n'), /1 entry in the folders was not a \.sql file and was ignored/);
});

test('input: files named one by one are read in the order given, and a file named twice is read once', async () => {
  const r = await run({ 'z.sql': 'DROP TABLE z;\n', 'a.sql': 'DROP TABLE a;\n' }, ['z.sql', 'a.sql', 'z.sql', '--format', 'json']);
  const report = JSON.parse(r.out);
  assert.deepEqual(report.findings.map((f) => f.table), ['z', 'a']);
  assert.match(report.notes.join('\n'), /1 file named twice was read once/);
});

test('input: a table that an earlier file created is new, so the order of the files decides', async () => {
  const files = { 'db/001_create.sql': 'CREATE TABLE a (x int);\n', 'db/002_drop.sql': 'DROP TABLE a;\n' };
  assert.equal((await run(files, ['db'])).code, 0);
  assert.equal((await run(files, ['db/002_drop.sql', 'db/001_create.sql'])).code, 1);
  assert.equal((await run(files, ['db', '--since', '002_drop.sql'])).code, 1);
  assert.equal((await run(files, ['db', '--since', 'db/002_drop.sql'])).code, 1);
  assert.equal((await run(files, ['db', '--since', 'missing.sql'])).code, 2);
});

test('input: a missing path, a folder with no .sql file and a file over the size limit stop the run with exit code 2', async () => {
  const none = await run({ 'db/readme.txt': 'x' }, ['db']);
  assert.equal(none.code, 2);
  assert.match(none.err, /db: no \.sql file in this folder/);
  const big = await run({ 'm.sql': 'SELECT 1;\n'.repeat(100) }, ['m.sql'], { maxFileBytes: 100, maxTotalBytes: 1000, maxFiles: 10, maxTokens: 100, maxStatements: 100, maxMetaFindings: 20 });
  assert.equal(big.code, 2);
  assert.match(big.err, /m\.sql: 1,000 bytes is over the 100 bytes limit/);
  const many = await run({ 'a.sql': 'SELECT 1;', 'b.sql': 'SELECT 1;', 'c.sql': 'SELECT 1;' }, ['a.sql', 'b.sql', 'c.sql'], { maxFileBytes: 1000, maxTotalBytes: 1000, maxFiles: 2, maxTokens: 100, maxStatements: 100, maxMetaFindings: 20 });
  assert.equal(many.code, 2);
  assert.match(many.err, /more than 2 files/);
  const total = await run({ 'a.sql': 'SELECT 1;\n'.repeat(5), 'b.sql': 'SELECT 1;\n'.repeat(5) }, ['a.sql', 'b.sql'], { maxFileBytes: 100, maxTotalBytes: 80, maxFiles: 10, maxTokens: 100, maxStatements: 100, maxMetaFindings: 20 });
  assert.equal(total.code, 2);
  assert.match(total.err, /together are over/);
});

test('input: a folder given as a file name entry, a pipe-like path and a symbolic link are handled without opening anything else', async (t) => {
  await withFiles({ 'real.sql': 'DROP TABLE a;\n', 'dir/x.sql': 'SELECT 1;\n' }, async (dir) => {
    let link = true;
    try {
      await symlink(resolve(dir, 'real.sql'), resolve(dir, 'link.sql'));
    } catch {
      link = false;
    }
    await mkdir(resolve(dir, 'sub.sql'));
    await writeFile(resolve(dir, 'dir/y.sql'), 'SELECT 2;\n');
    const folderAsName = await cli([resolve(dir, 'sub.sql')]);
    assert.equal(folderAsName.code, 2);
    assert.match(folderAsName.err, /no \.sql file in this folder/);
    if (link) assert.equal((await cli([resolve(dir, 'link.sql'), '--format', 'csv'])).code, 1);
    else t.diagnostic('symbolic links are not allowed here');
  });
});

test('paths: a file inside the folder is shown relative with forward slashes, one outside it with its absolute path', async () => {
  const inside = await run({ 'db/m.sql': RISKY }, ['db/m.sql', '--format', 'json']);
  assert.equal(JSON.parse(inside.out).findings[0].file, 'db/m.sql');
  await withFiles({ 'm.sql': RISKY }, async (dir) => {
    const r = await cli([resolve(dir, 'm.sql'), '--format', 'json']);
    const shown = JSON.parse(r.out).findings[0].file;
    assert.ok(!shown.includes('\\'), 'forward slashes only');
    assert.ok(shown.endsWith('/m.sql'));
  });
});

test('input: a byte order mark at the start of a file is ignored, and Windows line ends are read', async () => {
  const bom = String.fromCharCode(0xfeff);
  const r = await run({ 'm.sql': `${bom}SELECT 1;\r\nDROP TABLE a;\r\n` }, ['m.sql', '--format', 'json']);
  assert.equal(JSON.parse(r.out).findings[0].line, 2);
});

test('report text: the file and line, the statement, the message, the fix and the quoted manual sentence of every finding', () => {
  const text = toText(check(RISKY, { name: 'db/m.sql' }));
  assert.match(text, /^sql-migration-check: db\/m\.sql\n/);
  assert.match(text, /ERROR {4}drop-table {2}db\/m\.sql:1\n/);
  assert.match(text, /statement: DROP TABLE, table: visits/);
  assert.match(text, /fix: Expand and contract/);
  assert.match(text, /manual \(DROP TABLE, Description\): "DROP TABLE always removes any indexes/);
  assert.match(text, /https:\/\/www\.postgresql\.org\/docs\/current\/sql-droptable\.html/);
  assert.match(text, /GATE: FAIL - 1 error\n$/);
  assert.match(toText(check('SELECT 1;\n')), /no findings[\s\S]*GATE: PASS \(--fail-on error\)/);
});

test('report json: the whole report with the manual sentences, and it parses', () => {
  const report = JSON.parse(toJson(check(RISKY)));
  assert.equal(report.tool, 'sql-migration-check');
  assert.equal(report.dialect, 'PostgreSQL');
  assert.deepEqual(report.counts, { error: 1, warning: 1, info: 1 });
  assert.deepEqual(Object.keys(report.findings[0]).sort(), ['file', 'fix', 'id', 'line', 'manual', 'message', 'severity', 'statement', 'table']);
  assert.equal(report.findings[0].manual[0].url, 'https://www.postgresql.org/docs/current/sql-droptable.html');
  assert.equal(report.gate.pass, false);
});

test('report csv: a header and one row per finding, quoted as RFC 4180 says, with CRLF line ends', () => {
  const csv = toCsv(check(RISKY));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'severity,id,file,line,statement,table,message,fix,manual_page,manual_section,manual_url');
  assert.equal(lines.length, 5);
  assert.ok(lines[1].startsWith('error,drop-table,m.sql,1,DROP TABLE,visits,'));
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
});

test('report csv: a cell that starts like a formula gets a leading quote', async () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@x'), "'@x");
  const r = check('DROP TABLE "=cmd";\n', { name: '=file.sql' });
  const rows = toCsv(r).split('\r\n');
  assert.ok(rows[1].includes(",'=file.sql,"), 'file name');
  assert.ok(rows[1].includes(",'=cmd,"), 'table name');
});

test('report markdown: pipes, angle brackets and line breaks in names cannot break the table or add HTML', () => {
  assert.equal(mdCell('a|b<c>&d\\e\nf'), 'a\\|b&lt;c&gt;&amp;d\\\\e f');
  const md = toMarkdown(check('DROP TABLE "x|<script>";\n', { name: 'a|b.sql' }));
  assert.match(md, /^## sql-migration-check: 1 error, 0 warning, 0 info\n/);
  assert.ok(!md.includes('<script>'));
  const row = md.split('\n').find((l) => l.startsWith('| error'));
  assert.equal(row.replace(/\\\|/g, '').split('|').length, 9);
  assert.match(md, /\*\*Gate failed:\*\* 1 error\.\n$/);
});

test('the CLI prints the same report in every format and the same exit code', async () => {
  const files = { 'm.sql': RISKY };
  const outs = {};
  for (const format of ['text', 'markdown', 'json', 'csv']) {
    const r = await run(files, ['m.sql', '--format', format]);
    assert.equal(r.code, 1, format);
    outs[format] = r.out;
  }
  assert.match(outs.text, /drop-table/);
  assert.match(outs.markdown, /drop-table/);
  assert.equal(JSON.parse(outs.json).findings.length, 3);
  assert.equal(outs.csv.split('\r\n').length, 5);
});

test('no row data in any format: the value in an INSERT, a default and a comment is not printed', async () => {
  const secret = 'zz-row-value-9917';
  const sql = `-- ${secret}\nINSERT INTO visits (notes) VALUES ('${secret}');\nALTER TABLE visits ADD COLUMN c text DEFAULT '${secret}' NOT NULL;\nDELETE FROM visits;\n`;
  for (const format of ['text', 'markdown', 'json', 'csv']) {
    const r = await run({ 'm.sql': sql }, ['m.sql', '--format', format]);
    assert.equal(r.code, 1);
    assert.ok(!r.out.includes(secret), format);
    assert.ok(!r.err.includes(secret), format);
  }
});

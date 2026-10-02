import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { COMMAND_WORDS, FACTS, FINDINGS, LOCK_MODES, MANUAL_BASE, ORDER, SEVERITIES, SOURCES, TRANSACTION_COMMANDS, VOLATILE_FUNCTIONS, manualFor, sourceUrl } from '../src/index.js';

const dir = new URL('../research/sources/', import.meta.url);
const page = async (id) => readFile(new URL(SOURCES.find((s) => s.id === id).file, dir), 'utf8');
const source = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const quotes = (t) => t.split(String.fromCharCode(0x2019)).join("'").split(String.fromCharCode(0x2018)).join("'").split(String.fromCharCode(0x201c)).join('"').split(String.fromCharCode(0x201d)).join('"');
// Text compared without line breaks, runs of white space or the typographic quotes.
const flat = (t) => quotes(t).replace(/\s+/g, ' ').trim();
const has = (text, needle) => flat(text).includes(flat(needle));

test('sources: every saved page has its address on the first line and holds text', async () => {
  for (const s of SOURCES) {
    const text = await page(s.id);
    assert.equal(text.split('\n')[0], `Source: ${s.url}`, s.file);
    assert.ok(text.length > 800, `${s.file} holds the page text`);
    assert.equal(s.url, `${MANUAL_BASE}${s.page}.html`);
  }
  assert.equal(SOURCES.length, new Set(SOURCES.map((s) => s.url)).size);
  assert.equal(SOURCES.length, new Set(SOURCES.map((s) => s.file)).size);
});

test('sources: every file in research/sources is listed in src/data.js, and the other way round', async () => {
  const files = (await readdir(dir)).sort();
  assert.deepEqual(files, SOURCES.map((s) => s.file).sort());
});

test('sources: the pages come from the PostgreSQL manual only', () => {
  assert.equal(MANUAL_BASE, 'https://www.postgresql.org/docs/current/');
  for (const s of SOURCES) assert.match(s.url, /^https:\/\/www\.postgresql\.org\/docs\/current\/[a-z-]+\.html$/, s.url);
  assert.equal(sourceUrl('create-index'), 'https://www.postgresql.org/docs/current/sql-createindex.html');
});

test('sources: the title of every page is a heading of the saved text', async () => {
  for (const s of SOURCES) {
    const lines = (await page(s.id)).split('\n').map((l) => l.replace(/ #$/, ''));
    assert.ok(lines.includes(`# ${s.title}`), `${s.file}: # ${s.title}`);
  }
});

test('facts: every quoted sentence is on the saved page it names, word for word', async () => {
  for (const [key, fact] of Object.entries(FACTS)) {
    assert.ok(SOURCES.some((s) => s.id === fact.source), `${key}: source`);
    assert.ok(has(await page(fact.source), fact.text), `${key}: "${fact.text}"`);
  }
});

test('facts: the section of every fact is a heading of the saved page, and the sentence is under it', async () => {
  const minor = new Set(['# Note', '# Tip', '# Warning', '# Caution', '# Important']);
  for (const [key, fact] of Object.entries(FACTS)) {
    const lines = (await page(fact.source)).split(String.fromCharCode(10)).map((l) => l.replace(/ #$/, ''));
    const at = lines.indexOf(`# ${fact.section}`);
    assert.ok(at >= 0, `${key}: # ${fact.section}`);
    let end = at + 1;
    while (end < lines.length && !(lines[end].startsWith('# ') && !minor.has(lines[end]))) end += 1;
    assert.ok(has(lines.slice(at, end).join(' '), fact.text), `${key}: the sentence is under ${fact.section}`);
  }
});

test('facts: the lock names in the messages and in src/data.js are the lock modes that the manual lists', async () => {
  const locking = await page('explicit-locking');
  const modes = new Set([...locking.matchAll(/^([A-Z][A-Z ]+) \((\w+Lock)\)$/gm)].map((m) => m[1]));
  assert.equal(modes.size, 8);
  for (const mode of Object.values(LOCK_MODES)) assert.ok(modes.has(mode), mode);
  const code = (await source('../src/rules.js')) + (await source('../src/data.js'));
  const used = new Set([...code.matchAll(/\b(?:ACCESS|ROW|SHARE UPDATE|SHARE ROW) (?:SHARE|EXCLUSIVE)\b/g)].map((m) => m[0]));
  assert.ok(used.size >= 3);
  for (const name of used) assert.ok(modes.has(name), `${name} is a lock mode of the manual`);
});

test('facts: the lock that each statement takes is stated by the manual page of that statement', async () => {
  assert.ok(has(await page('explicit-locking'), 'Acquired by the DROP TABLE, TRUNCATE, REINDEX, CLUSTER, VACUUM FULL, and REFRESH MATERIALIZED VIEW (without CONCURRENTLY) commands.'));
  assert.ok(has(await page('truncate'), 'TRUNCATE acquires an ACCESS EXCLUSIVE lock on each table'));
  assert.ok(has(await page('cluster'), 'an ACCESS EXCLUSIVE lock is acquired on it'));
  assert.ok(has(await page('vacuum'), 'requires an ACCESS EXCLUSIVE lock on each table'));
  assert.ok(has(await page('lock'), 'If no lock mode is specified, then ACCESS EXCLUSIVE'));
  assert.ok(has(await page('alter-table'), 'An ACCESS EXCLUSIVE lock is acquired unless explicitly noted.'));
  assert.ok(has(await page('alter-table'), 'ADD FOREIGN KEY requires only a SHARE ROW EXCLUSIVE lock'));
  assert.ok(has(await page('alter-table'), 'validation acquires only a SHARE UPDATE EXCLUSIVE lock'));
});

test('facts: the functions that the tool names as volatile are named as volatile on the saved pages', async () => {
  assert.deepEqual(VOLATILE_FUNCTIONS.map((f) => f.name).sort(), ['clock_timestamp', 'currval', 'random', 'timeofday']);
  for (const f of VOLATILE_FUNCTIONS) assert.ok((await page(f.source)).includes(`${f.name}()`), f.name);
  assert.ok(has(await page('alter-table'), 'volatile DEFAULT (e.g., clock_timestamp())'));
  assert.ok(has(await page('function-volatility'), 'some examples are random(), currval(), timeofday()'));
});

test('facts: the statements that open or close a transaction block have a page each, with the heading and the keyword', async () => {
  assert.deepEqual(TRANSACTION_COMMANDS.map((c) => c.words), ['BEGIN', 'START TRANSACTION', 'COMMIT', 'END', 'ROLLBACK', 'ABORT', 'ROLLBACK TO']);
  for (const c of TRANSACTION_COMMANDS) {
    const text = await page(c.source);
    assert.ok(text.includes(`\n# ${c.heading}`), c.words);
    assert.ok(text.includes(`${c.words.split(' ')[0]} `), c.words);
  }
  assert.ok(has(await page('end'), 'END commits the current transaction'));
  assert.ok(has(await page('abort'), 'ABORT rolls back the current transaction'));
  assert.ok(has(await page('commit'), 'If AND CHAIN is specified, a new transaction is immediately started'));
  assert.ok(has(await page('rollback-to'), 'ROLLBACK [ WORK | TRANSACTION ] TO [ SAVEPOINT ] savepoint_name'));
});

test('facts: the words that start a known statement are the first words of the list of SQL commands, plus WITH and TABLE of SELECT', async () => {
  const list = await page('sql-commands');
  const dash = String.fromCharCode(0x2014);
  const first = new Set([...list.matchAll(new RegExp(`^([A-Z]+)(?: [A-Z ]+)? ${dash} `, 'gm'))].map((m) => m[1]));
  assert.ok(first.size >= 45);
  const extra = [...COMMAND_WORDS].filter((w) => !first.has(w)).sort();
  assert.deepEqual(extra, ['TABLE', 'WITH']);
  for (const w of first) assert.ok(COMMAND_WORDS.has(w), w);
  const select = await page('select');
  assert.ok(select.includes('[ WITH [ RECURSIVE ] with_query'));
  assert.ok(select.includes('\nTABLE [ ONLY ] table_name'));
});

test('facts: the syntax that the checks read is in the synopsis of the manual', async () => {
  const alter = await page('alter-table');
  for (const s of ['ADD [ COLUMN ] [ IF NOT EXISTS ] column_name data_type', 'DROP [ COLUMN ] [ IF EXISTS ] column_name', 'ALTER [ COLUMN ] column_name [ SET DATA ] TYPE data_type', 'ALTER [ COLUMN ] column_name { SET | DROP } NOT NULL', 'ADD table_constraint [ NOT VALID ]', 'VALIDATE CONSTRAINT constraint_name', 'RENAME [ COLUMN ] column_name TO new_column_name', 'RENAME CONSTRAINT constraint_name TO new_constraint_name', 'RENAME TO new_name', 'ENFORCED | NOT ENFORCED']) assert.ok(alter.includes(s), s);
  assert.ok(has(alter, 'which is currently only allowed for foreign-key, CHECK, and not-null constraints'));
  assert.ok((await page('create-index')).includes('CREATE [ UNIQUE ] INDEX [ CONCURRENTLY ] [ [ IF NOT EXISTS ] name ] ON [ ONLY ] table_name'));
  assert.ok((await page('truncate')).includes('TRUNCATE [ TABLE ] [ ONLY ] name [ * ] [, ... ]'));
  assert.ok((await page('delete')).includes('DELETE FROM [ ONLY ] table_name [ * ]'));
  assert.ok((await page('delete')).includes('[ WHERE condition | WHERE CURRENT OF cursor_name ]'));
  assert.ok((await page('update')).includes('[ WHERE condition | WHERE CURRENT OF cursor_name ]'));
  assert.ok((await page('lock')).includes('LOCK [ TABLE ] [ ONLY ] name [ * ] [, ...] [ IN lockmode MODE ] [ NOWAIT ]'));
  assert.ok((await page('vacuum')).includes('FULL [ boolean ]'));
  assert.ok((await page('cluster')).includes('CLUSTER [ ( option [, ...] ) ] [ table_name [ USING index_name ] ]'));
  assert.ok((await page('drop-table')).includes('DROP TABLE [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]'));
  assert.ok((await page('create-table')).includes('CREATE [ [ GLOBAL | LOCAL ] { TEMPORARY | TEMP } | UNLOGGED ] TABLE [ IF NOT EXISTS ] table_name'));
});

test('findings: every check has a unique id, a severity, an order and facts that exist', () => {
  assert.equal(new Set(FINDINGS.map((f) => f.id)).size, FINDINGS.length);
  for (const f of FINDINGS) {
    assert.match(f.id, /^[a-z]+(?:-[a-z]+)*$/);
    assert.ok(SEVERITIES.includes(f.severity), f.id);
    assert.equal(typeof ORDER[f.id], 'number');
    for (const key of [...f.facts, ...(f.optional ?? [])]) assert.ok(FACTS[key], `${f.id}: ${key}`);
  }
  assert.deepEqual([...FINDINGS.map((f) => f.severity)], [...FINDINGS.map((f) => f.severity)].sort((a, b) => SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b)));
});

test('findings: the checks that rest on the manual quote it, and the ones about the file itself do not', () => {
  const own = ['unterminated-token', 'limit-reached', 'missing-terminator', 'unparsed-statement', 'do-block-not-read', 'meta-command'];
  for (const f of FINDINGS) assert.equal(f.facts.length === 0, own.includes(f.id), f.id);
  const m = manualFor('index-not-concurrent');
  assert.equal(m.length, 1);
  assert.deepEqual(Object.keys(m[0]).sort(), ['page', 'quote', 'section', 'url']);
});

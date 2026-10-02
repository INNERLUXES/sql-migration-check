import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, checkSet, afterExisting, ids, find } from './helpers.js';

test('index-not-concurrent: CREATE INDEX on an existing table is a warning that names the file, the line and the manual', () => {
  const r = afterExisting('SELECT 1;\nCREATE INDEX visits_starts_idx ON visits (starts_at);\n');
  const f = find(r, 'index-not-concurrent');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'warning');
  assert.equal(f[0].file, '002_change.sql');
  assert.equal(f[0].line, 2);
  assert.equal(f[0].statement, 'CREATE INDEX');
  assert.equal(f[0].table, 'visits');
  assert.match(f[0].manual[0].url, /^https:\/\/www\.postgresql\.org\/docs\/current\/sql-createindex\.html$/);
  assert.match(f[0].manual[0].quote, /locks out writes \(but not reads\)/);
  assert.ok(f[0].fix.length > 20);
});

test('index-not-concurrent: CONCURRENTLY, a unique index, an unnamed index and ONLY are read, and only the plain one is reported', () => {
  const r = afterExisting([
    'CREATE INDEX CONCURRENTLY a ON visits (id);',
    'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS b ON visits (id);',
    'CREATE INDEX ON ONLY visits (id);',
    'CREATE UNIQUE INDEX c ON public.patients USING btree (id);'
  ].join('\n'));
  assert.deepEqual(find(r, 'index-not-concurrent').map((f) => f.line), [3, 4]);
});

test('new tables: an index on a table that the same set created before is not reported, also through the public schema', () => {
  const r = check('CREATE TABLE public.rooms (id int);\nCREATE INDEX a ON rooms (id);\nCREATE TABLE IF NOT EXISTS beds (id int);\nCREATE INDEX b ON public.beds (id);\n');
  assert.deepEqual(ids(r), []);
});

test('new tables: the set has to create the table before the statement, and in an earlier file it counts too', () => {
  const late = check('CREATE INDEX a ON rooms (id);\nCREATE TABLE rooms (id int);\n');
  assert.deepEqual(ids(late), ['index-not-concurrent']);
  const files = checkSet({ '001.sql': 'CREATE TABLE rooms (id int);', '002.sql': 'CREATE INDEX a ON rooms (id);\nALTER TABLE rooms ADD COLUMN x int NOT NULL;' });
  assert.deepEqual(ids(files), []);
});

test('new tables: a dropped table is not new any more, and a table created again after DROP is new again', () => {
  const r = check('CREATE TABLE rooms (id int);\nDROP TABLE rooms;\nCREATE INDEX a ON rooms (id);\nCREATE TABLE rooms (id int);\nCREATE INDEX b ON rooms (id);\n');
  assert.deepEqual(ids(r), ['index-not-concurrent']);
  assert.equal(r.findings[0].line, 3);
});

test('new tables: a new table that is renamed stays new under its new name, and an existing one is reported', () => {
  const r = check('CREATE TABLE rooms (id int);\nALTER TABLE rooms RENAME TO wards;\nCREATE INDEX a ON wards (id);\n');
  assert.deepEqual(ids(r), []);
  assert.deepEqual(ids(afterExisting('ALTER TABLE visits RENAME TO appointments;')), ['rename-table']);
});

test('new tables: quoted names keep their case, unquoted names do not', () => {
  const r = check('CREATE TABLE "Rooms" (id int);\nCREATE INDEX a ON rooms (id);\nCREATE INDEX b ON "Rooms" (id);\nCREATE INDEX c ON ROOMS (id);\n');
  assert.deepEqual(find(r, 'index-not-concurrent').map((f) => f.line), [2, 4]);
  const same = check('CREATE TABLE Rooms (id int);\nCREATE INDEX a ON rooms (id);\nCREATE INDEX b ON "rooms" (id);\n');
  assert.deepEqual(ids(same), []);
});

test('--since: files before it are read for the table names only and report nothing', () => {
  const r = checkSet({ '001.sql': 'CREATE TABLE rooms (id int);\nDROP TABLE rooms;\nCREATE TABLE rooms (id int);\nDELETE FROM rooms', '002.sql': 'CREATE INDEX a ON rooms (id);' }, { since: '002.sql' });
  assert.deepEqual(ids(r), ['index-not-concurrent']);
  assert.equal(r.input.files[0].baseline, true);
  assert.match(r.notes[0], /1 file before 002\.sql was read only to learn which tables already exist/);
  assert.throws(() => checkSet({ '001.sql': '' }, { since: 'nope.sql' }), /not one of the files given/);
});

test('concurrently-in-transaction: CREATE INDEX CONCURRENTLY between BEGIN and COMMIT is an error', () => {
  const r = afterExisting('BEGIN;\nCREATE INDEX CONCURRENTLY a ON visits (id);\nCOMMIT;\nCREATE INDEX CONCURRENTLY b ON visits (id);');
  const f = find(r, 'concurrently-in-transaction');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'error');
  assert.equal(f[0].line, 2);
  assert.match(f[0].message, /BEGIN at line 1/);
  assert.match(f[0].manual[0].quote, /CREATE INDEX CONCURRENTLY cannot\./);
});

test('concurrently-in-transaction: START TRANSACTION counts, END and ABORT close it, and each file starts outside a transaction', () => {
  const start = afterExisting('START TRANSACTION ISOLATION LEVEL SERIALIZABLE;\nCREATE INDEX CONCURRENTLY a ON visits (id);');
  assert.deepEqual(ids(start), ['concurrently-in-transaction']);
  for (const close of ['END', 'ABORT', 'ROLLBACK', 'COMMIT WORK']) {
    assert.deepEqual(ids(afterExisting(`BEGIN;\n${close};\nCREATE INDEX CONCURRENTLY a ON visits (id);`)), [], close);
  }
  const files = checkSet({ '001.sql': 'CREATE TABLE visits (id int);', '002.sql': 'BEGIN;\nSELECT 1;', '003.sql': 'CREATE INDEX CONCURRENTLY a ON visits (id);' }, { since: '002.sql' });
  assert.deepEqual(ids(files), []);
});

test('concurrently-in-transaction: ROLLBACK TO SAVEPOINT and COMMIT AND CHAIN do not leave the transaction', () => {
  assert.deepEqual(ids(afterExisting('BEGIN;\nROLLBACK TO SAVEPOINT s;\nCREATE INDEX CONCURRENTLY a ON visits (id);')), ['concurrently-in-transaction']);
  assert.deepEqual(ids(afterExisting('BEGIN;\nCOMMIT AND CHAIN;\nCREATE INDEX CONCURRENTLY a ON visits (id);')), ['concurrently-in-transaction']);
  assert.deepEqual(ids(afterExisting('BEGIN;\nCOMMIT AND NO CHAIN;\nCREATE INDEX CONCURRENTLY a ON visits (id);')), []);
});

test('add-column-not-null-no-default: an existing table gets an error, and the near misses get none', () => {
  const r = afterExisting([
    'ALTER TABLE visits ADD COLUMN a text NOT NULL;',
    'ALTER TABLE visits ADD COLUMN b text NOT NULL DEFAULT \'x\';',
    'ALTER TABLE visits ADD COLUMN c text;',
    'ALTER TABLE visits ADD COLUMN d int DEFAULT 0 NOT NULL;',
    'ALTER TABLE visits ADD d int NOT NULL;',
    'ALTER TABLE visits ADD COLUMN e text DEFAULT NULL NOT NULL;'
  ].join('\n'));
  assert.deepEqual(find(r, 'add-column-not-null-no-default').map((f) => f.line), [1, 5, 6]);
  assert.equal(find(r, 'add-column-not-null-no-default')[0].severity, 'error');
  assert.equal(find(r, 'add-column-not-null-no-default')[0].manual.length, 2);
});

test('add-column-not-null-no-default: a new table gets none, and neither does a column that is not added', () => {
  assert.deepEqual(ids(check('CREATE TABLE rooms (id int);\nALTER TABLE rooms ADD COLUMN a text NOT NULL;')), []);
  assert.deepEqual(ids(afterExisting('ALTER TABLE visits ADD CONSTRAINT k CHECK (notes IS NOT NULL) NOT VALID;')), []);
});

test('ALTER TABLE with several actions: each action is read and reported at its own line', () => {
  const r = afterExisting('ALTER TABLE visits\n  ADD COLUMN a text NOT NULL,\n  ADD COLUMN b int DEFAULT 1,\n  DROP COLUMN notes,\n  ALTER COLUMN email SET NOT NULL;');
  assert.deepEqual(r.findings.map((f) => [f.id, f.line]), [
    ['add-column-not-null-no-default', 2],
    ['drop-column', 4],
    ['set-not-null', 5]
  ]);
});

test('add-column-volatile-default: clock_timestamp, random, currval and timeofday are named by the manual and are warnings', () => {
  for (const fn of ['clock_timestamp()', 'random()', 'currval(\'s\')', 'timeofday()']) {
    const r = afterExisting(`ALTER TABLE visits ADD COLUMN a double precision DEFAULT ${fn};`);
    assert.deepEqual(ids(r), ['add-column-volatile-default'], fn);
    assert.equal(r.findings[0].severity, 'warning');
  }
  const wrapped = afterExisting('ALTER TABLE visits ADD COLUMN a text DEFAULT (lower(\'X\') || random()::text);');
  assert.deepEqual(ids(wrapped), ['add-column-volatile-default', 'default-function-unclassified']);
});

test('add-column-volatile-default: a constant, a cast and a keyword with parentheses are not calls', () => {
  const r = afterExisting([
    'ALTER TABLE visits ADD COLUMN a text DEFAULT \'x\';',
    'ALTER TABLE visits ADD COLUMN b numeric(10,2) DEFAULT 0::numeric(10,2);',
    'ALTER TABLE visits ADD COLUMN c int DEFAULT COALESCE(1, 2);',
    'ALTER TABLE visits ADD COLUMN d timestamptz DEFAULT CURRENT_TIMESTAMP;',
    'ALTER TABLE visits ADD COLUMN e int DEFAULT CAST(1 AS int);'
  ].join('\n'));
  assert.deepEqual(ids(r), []);
});

test('default-function-unclassified: a function that the manual does not name as volatile is an info, never a failure', () => {
  const r = afterExisting('ALTER TABLE visits ADD COLUMN a timestamptz DEFAULT now();\nALTER TABLE visits ADD COLUMN b bigserial;\nALTER TABLE visits ADD COLUMN c uuid DEFAULT gen_random_uuid();');
  assert.deepEqual(ids(r), ['default-function-unclassified', 'default-function-unclassified', 'default-function-unclassified']);
  assert.ok(r.findings.every((f) => f.severity === 'info'));
  assert.equal(r.gate.pass, true);
  assert.equal(check('SELECT 1;', { failOn: 'warning' }).gate.pass, true);
});

test('add-column-rewrite: an identity column and a stored generated column rewrite the table, a virtual one does not', () => {
  const r = afterExisting([
    'ALTER TABLE visits ADD COLUMN a bigint GENERATED ALWAYS AS IDENTITY;',
    'ALTER TABLE visits ADD COLUMN b int GENERATED ALWAYS AS (id * 2) STORED;',
    'ALTER TABLE visits ADD COLUMN c int GENERATED ALWAYS AS (id * 2) VIRTUAL;'
  ].join('\n'));
  assert.deepEqual(find(r, 'add-column-rewrite').map((f) => f.line), [1, 2]);
  assert.deepEqual(find(r, 'add-column-not-null-no-default'), []);
});

test('alter-column-type: TYPE and SET DATA TYPE are warnings, SET DEFAULT is not', () => {
  const r = afterExisting('ALTER TABLE visits ALTER COLUMN notes TYPE varchar(200);\nALTER TABLE visits ALTER notes SET DATA TYPE text USING notes::text;\nALTER TABLE visits ALTER COLUMN notes SET DEFAULT \'\';');
  assert.deepEqual(r.findings.map((f) => [f.id, f.line, f.severity]), [['alter-column-type', 1, 'warning'], ['alter-column-type', 2, 'warning']]);
  assert.match(r.findings[0].manual[0].quote, /normally cause the entire table and its indexes to be rewritten/);
});

test('set-not-null: SET NOT NULL is a warning, DROP NOT NULL is not', () => {
  const r = afterExisting('ALTER TABLE visits ALTER COLUMN email SET NOT NULL;\nALTER TABLE visits ALTER COLUMN email DROP NOT NULL;');
  assert.deepEqual(ids(r), ['set-not-null']);
  assert.match(r.findings[0].fix, /CHECK \(email IS NOT NULL\) NOT VALID/);
  assert.match(r.findings[0].manual[0].quote, /then the table scan is skipped/);
});

test('set-not-null: after a CHECK (column IS NOT NULL) NOT VALID that was validated, the scan is skipped and nothing is reported', () => {
  const sql = [
    'ALTER TABLE visits ADD CONSTRAINT email_present CHECK (email IS NOT NULL) NOT VALID;',
    'ALTER TABLE visits VALIDATE CONSTRAINT email_present;',
    'ALTER TABLE visits ALTER COLUMN email SET NOT NULL;'
  ].join('\n');
  assert.deepEqual(ids(afterExisting(sql)), ['validate-constraint']);
  const notValidated = afterExisting(sql.split('\n').filter((l, i) => i !== 1).join('\n'));
  assert.deepEqual(ids(notValidated), ['set-not-null']);
  const otherColumn = afterExisting(sql.replace('ALTER COLUMN email SET', 'ALTER COLUMN notes SET'));
  assert.deepEqual(ids(otherColumn), ['validate-constraint', 'set-not-null']);
  const otherTable = afterExisting(sql.replace('ALTER TABLE visits ALTER COLUMN', 'ALTER TABLE patients ALTER COLUMN'));
  assert.deepEqual(ids(otherTable), ['validate-constraint', 'set-not-null']);
});

test('add-constraint-without-not-valid: FOREIGN KEY and CHECK are warnings, NOT VALID, NOT ENFORCED and UNIQUE are not', () => {
  const r = afterExisting([
    'ALTER TABLE visits ADD CONSTRAINT a FOREIGN KEY (patient_id) REFERENCES patients (id);',
    'ALTER TABLE visits ADD CONSTRAINT b CHECK (id > 0);',
    'ALTER TABLE visits ADD FOREIGN KEY (patient_id) REFERENCES patients (id);',
    'ALTER TABLE visits ADD CONSTRAINT c FOREIGN KEY (patient_id) REFERENCES patients (id) NOT VALID;',
    'ALTER TABLE visits ADD CONSTRAINT d CHECK (id > 0) NOT VALID;',
    'ALTER TABLE visits ADD CONSTRAINT e CHECK (id > 0) NOT ENFORCED;',
    'ALTER TABLE visits ADD CONSTRAINT f UNIQUE (id);'
  ].join('\n'));
  assert.deepEqual(find(r, 'add-constraint-without-not-valid').map((f) => f.line), [1, 2, 3]);
  assert.equal(find(r, 'add-constraint-without-not-valid')[0].manual.length, 3);
  assert.equal(find(r, 'add-constraint-without-not-valid')[1].manual.length, 2);
});

test('validate-constraint: VALIDATE CONSTRAINT is an info with the SHARE UPDATE EXCLUSIVE lock named', () => {
  const r = afterExisting('ALTER TABLE visits VALIDATE CONSTRAINT a;');
  assert.deepEqual(r.findings.map((f) => [f.id, f.severity]), [['validate-constraint', 'info']]);
  assert.match(r.findings[0].message, /SHARE UPDATE EXCLUSIVE/);
});

test('drop-table: an existing table is an error with the data-loss note, IF EXISTS and CASCADE are read, a new table is not reported', () => {
  const r = afterExisting('DROP TABLE IF EXISTS visits, patients CASCADE;\nCREATE TABLE tmp (id int);\nDROP TABLE tmp;');
  assert.deepEqual(r.findings.map((f) => [f.id, f.severity, f.line, f.table]), [['drop-table', 'error', 1, 'visits, patients']]);
  assert.match(r.findings[0].fix, /Expand and contract/);
});

test('drop-column: an existing table is an error, DROP CONSTRAINT is not a column, a new table is not reported', () => {
  const r = afterExisting('ALTER TABLE visits DROP COLUMN IF EXISTS notes CASCADE;\nALTER TABLE visits DROP notes;\nALTER TABLE visits DROP CONSTRAINT k;');
  assert.deepEqual(r.findings.map((f) => [f.id, f.line]), [['drop-column', 1], ['drop-column', 2]]);
  assert.deepEqual(ids(check('CREATE TABLE a (x int);\nALTER TABLE a DROP COLUMN x;')), []);
});

test('truncate: every spelling is an error on an existing table, and a new table is not reported', () => {
  const r = afterExisting('TRUNCATE visits;\nTRUNCATE TABLE ONLY visits, patients RESTART IDENTITY CASCADE;\nCREATE TABLE tmp (id int);\nTRUNCATE tmp;');
  assert.deepEqual(r.findings.map((f) => [f.id, f.line, f.table]), [['truncate', 1, 'visits'], ['truncate', 2, 'visits, patients']]);
  assert.equal(r.findings[0].severity, 'error');
});

test('delete-without-where: no WHERE is an error; a WHERE, WHERE CURRENT OF and a WHERE after USING are not', () => {
  const r = afterExisting([
    'DELETE FROM visits;',
    'DELETE FROM visits WHERE id = 1;',
    'DELETE FROM visits USING patients WHERE visits.patient_id = patients.id;',
    'DELETE FROM ONLY visits WHERE CURRENT OF c;',
    'DELETE FROM visits RETURNING id;'
  ].join('\n'));
  assert.deepEqual(find(r, 'delete-without-where').map((f) => f.line), [1, 5]);
});

test('delete-without-where: a WHERE that is only inside a sub-select does not count, and WITH ... DELETE is read', () => {
  const r = afterExisting([
    'DELETE FROM visits WHERE id IN (SELECT id FROM patients);',
    'DELETE FROM visits AS v WHERE (SELECT 1 WHERE true) = 1;',
    'UPDATE visits SET notes = (SELECT notes FROM patients WHERE id = 1);',
    'WITH old AS (SELECT id FROM patients WHERE id > 1) DELETE FROM visits;',
    'WITH old AS (SELECT id FROM patients), more AS (SELECT 1) DELETE FROM visits WHERE id IN (SELECT id FROM old);'
  ].join('\n'));
  assert.deepEqual(r.findings.map((f) => [f.id, f.line]), [['update-without-where', 3], ['delete-without-where', 4]]);
});

test('update-without-where: no WHERE is an error; a WHERE, a FROM with WHERE and a new table are not', () => {
  const r = afterExisting([
    'UPDATE visits SET notes = \'x\';',
    'UPDATE visits SET notes = \'x\' WHERE id = 1;',
    'UPDATE ONLY visits v SET notes = p.email FROM patients p WHERE p.id = v.patient_id;',
    'CREATE TABLE tmp (n text);',
    'UPDATE tmp SET n = \'y\';'
  ].join('\n'));
  assert.deepEqual(r.findings.map((f) => [f.id, f.line, f.severity]), [['update-without-where', 1, 'error']]);
});

test('rename-column and rename-table: both are warnings, RENAME CONSTRAINT is not', () => {
  const r = afterExisting('ALTER TABLE visits RENAME COLUMN notes TO remarks;\nALTER TABLE visits RENAME notes TO remarks;\nALTER TABLE visits RENAME CONSTRAINT a TO b;\nALTER TABLE patients RENAME TO people;');
  assert.deepEqual(r.findings.map((f) => [f.id, f.line, f.severity]), [['rename-column', 1, 'warning'], ['rename-column', 2, 'warning'], ['rename-table', 4, 'warning']]);
  assert.match(r.findings[0].message, /notes TO remarks/);
});

test('lock-table-access-exclusive: ACCESS EXCLUSIVE and no mode at all are warnings, a weaker mode is not', () => {
  const r = afterExisting([
    'LOCK TABLE visits IN ACCESS EXCLUSIVE MODE;',
    'LOCK visits;',
    'LOCK TABLE ONLY visits, patients NOWAIT;',
    'LOCK TABLE visits IN SHARE ROW EXCLUSIVE MODE;',
    'LOCK TABLE visits IN ACCESS SHARE MODE;'
  ].join('\n'));
  assert.deepEqual(find(r, 'lock-table-access-exclusive').map((f) => f.line), [1, 2, 3]);
  assert.equal(find(r, 'lock-table-access-exclusive')[0].manual.length, 2);
  assert.equal(find(r, 'lock-table-access-exclusive')[1].manual.length, 3);
});

test('vacuum-full: FULL as a word or as an option is a warning, plain VACUUM, FULL false and a new table are not', () => {
  const r = afterExisting([
    'VACUUM FULL visits;',
    'VACUUM (FULL, ANALYZE) visits;',
    'VACUUM (FULL true) patients;',
    'VACUUM FULL;',
    'VACUUM visits;',
    'VACUUM (ANALYZE) visits;',
    'VACUUM (FULL false) visits;',
    'VACUUM (FULL off) visits;',
    'CREATE TABLE tmp (n int);',
    'VACUUM FULL tmp;'
  ].join('\n'));
  assert.deepEqual(find(r, 'vacuum-full').map((f) => f.line), [1, 2, 3, 4]);
  assert.equal(find(r, 'vacuum-full')[3].table, null);
});

test('cluster: every form is a warning, a new table is not reported', () => {
  const r = afterExisting('CLUSTER visits USING visits_pkey;\nCLUSTER VERBOSE visits;\nCLUSTER;\nCREATE TABLE tmp (n int);\nCLUSTER tmp;\nALTER TABLE visits CLUSTER ON visits_pkey;');
  assert.deepEqual(find(r, 'cluster').map((f) => [f.line, f.table]), [[1, 'visits'], [2, 'visits'], [3, null]]);
});

test('missing-terminator: the last statement without a semicolon is a warning at its last line', () => {
  const r = check('SELECT 1;\nSELECT 2\n  FROM t');
  assert.deepEqual(r.findings.map((f) => [f.id, f.severity, f.line, f.statement]), [['missing-terminator', 'warning', 3, 'SELECT']]);
  assert.deepEqual(ids(check('SELECT 1;\n-- done\n')), []);
});

test('unparsed-statement: an unknown command and unbalanced parentheses are reported, never skipped', () => {
  const r = check('FROBNICATE the tables;\nSELECT (1;\nSELECT 2);\nSELECT 3;');
  assert.deepEqual(r.findings.map((f) => [f.id, f.line]), [['unparsed-statement', 1], ['unparsed-statement', 2], ['unparsed-statement', 3]]);
  assert.match(r.findings[0].message, /FROBNICATE/);
  assert.equal(r.input.unparsed, 3);
  assert.equal(r.gate.pass, true);
  assert.equal(check('FROBNICATE;', { failOn: 'warning' }).gate.pass, false);
});

test('unparsed-statement: CREATE INDEX with no ON table is reported', () => {
  assert.deepEqual(ids(check('CREATE INDEX a b c;')), ['unparsed-statement']);
});

test('unterminated-token: an open string is an error, the statements before it are still checked, and the cut statement is not reported twice', () => {
  const r = afterExisting('DROP TABLE visits;\nSELECT \'never closed;\nDROP TABLE patients;');
  assert.deepEqual(r.findings.map((f) => [f.id, f.line]), [['drop-table', 1], ['unterminated-token', 2]]);
  assert.equal(r.findings[1].severity, 'error');
  assert.equal(r.gate.pass, false);
});

test('meta-command and do-block-not-read: a psql line and a DO block are named in the report, as info', () => {
  const r = afterExisting('\\set ON_ERROR_STOP on\nDO $$ BEGIN DELETE FROM visits; END $$;');
  assert.deepEqual(r.findings.map((f) => [f.id, f.severity, f.line]), [['meta-command', 'info', 1], ['do-block-not-read', 'info', 2]]);
});

test('limit-reached: a file with more statements than the limit is an error that says the rest was not checked', () => {
  const r = check('SELECT 1; SELECT 2; SELECT 3;', { limits: { maxTokens: 1000, maxStatements: 2, maxMetaFindings: 20 } });
  assert.deepEqual(ids(r), ['limit-reached']);
  assert.equal(r.findings[0].severity, 'error');
});

test('statements that only read or insert are counted, and said so in a note', () => {
  const r = check('SELECT 1;\nINSERT INTO t VALUES (1);\nCREATE TABLE a (x int);');
  assert.equal(r.input.statements, 3);
  assert.match(r.notes.join('\n'), /3 statements were understood but have no check/);
  assert.match(check('').notes.join('\n'), /No statement was found/);
});

test('names and quotes: a quoted name with spaces and a schema is shown as written and cleaned of control characters', () => {
  const bell = String.fromCharCode(7);
  const r = check(`CREATE TABLE s.a (x int);\nDROP TABLE "odd${bell}name", s.a;`);
  assert.deepEqual(r.findings.map((f) => f.table), ['odd name']);
  assert.ok(!JSON.stringify(r).includes(bell));
});

test('no row data: values, strings, comments and dollar bodies of a migration never reach any part of the report', () => {
  const secret = 'zz-row-value-4471';
  const sql = `-- ${secret}\nINSERT INTO visits (notes) VALUES ('${secret}');\nUPDATE visits SET notes = '${secret}';\nDO $$ SELECT '${secret}' $$;\nALTER TABLE visits ADD COLUMN c text DEFAULT '${secret}';\nDELETE FROM visits WHERE notes = '${secret}';\nDELETE FROM visits;\n`;
  const r = afterExisting(sql);
  assert.ok(r.findings.length >= 2);
  assert.ok(!JSON.stringify(r).includes(secret));
});

test('the same input always gives the same report', () => {
  const sql = 'DROP TABLE a;\nTRUNCATE b;\nALTER TABLE c ADD COLUMN x int NOT NULL;';
  assert.deepEqual(check(sql), check(sql));
});

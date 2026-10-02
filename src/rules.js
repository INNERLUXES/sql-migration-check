// The checks. Each one reads the tokens of one statement (never the raw text) and reports a finding with a severity, the
// statement kind, a message, a fix and the sentences of the PostgreSQL manual that it rests on (src/data.js FACTS).
// docs/method.md gives the exact rule of every check, what it can see and what it cannot.
//
// A table that an earlier statement of the same migration set created is a "new table": nobody else uses it yet and it
// holds no rows, so no check that is about a table in use fires on it (docs/method.md, "New tables").

import { COMMAND_WORDS, LOCK_MODES, VOLATILE_FUNCTIONS } from './data.js';

export const SEVERITIES = ['error', 'warning', 'info'];
export const RANK = { error: 0, warning: 1, info: 2 };

// id, severity and the facts (keys of FACTS) that a finding quotes; optional facts are quoted only when the statement has
// the feature they are about (a foreign key, a LOCK TABLE with no mode). The order is the order of the report within a line.
export const FINDINGS = [
  { id: 'unterminated-token', severity: 'error', facts: [] },
  { id: 'limit-reached', severity: 'error', facts: [] },
  { id: 'concurrently-in-transaction', severity: 'error', facts: ['index-concurrently-transaction', 'transaction-block'] },
  { id: 'add-column-not-null-no-default', severity: 'error', facts: ['add-column-null-default', 'not-null-meaning'] },
  { id: 'drop-table', severity: 'error', facts: ['drop-table', 'access-exclusive-commands'] },
  { id: 'drop-column', severity: 'error', facts: ['drop-column'] },
  { id: 'truncate', severity: 'error', facts: ['truncate-removes-rows', 'truncate-lock', 'truncate-use-delete'] },
  { id: 'delete-without-where', severity: 'error', facts: ['delete-all-rows'] },
  { id: 'update-without-where', severity: 'error', facts: ['update-condition'] },
  { id: 'index-not-concurrent', severity: 'warning', facts: ['index-blocks-writes'] },
  { id: 'add-column-volatile-default', severity: 'warning', facts: ['add-column-volatile-rewrite', 'volatile-examples', 'set-default-new-rows'] },
  { id: 'add-column-rewrite', severity: 'warning', facts: ['add-column-volatile-rewrite', 'alter-lock-level'] },
  { id: 'alter-column-type', severity: 'warning', facts: ['type-change-rewrite', 'alter-lock-level', 'rewrite-disk-and-time'] },
  { id: 'set-not-null', severity: 'warning', facts: ['set-not-null-scan', 'alter-lock-level', 'not-valid-pattern'] },
  { id: 'add-constraint-without-not-valid', severity: 'warning', facts: ['add-constraint-scan-lock', 'not-valid-pattern'], optional: ['foreign-key-lock'] },
  { id: 'rename-column', severity: 'warning', facts: ['rename-forms'] },
  { id: 'rename-table', severity: 'warning', facts: ['rename-forms'] },
  { id: 'lock-table-access-exclusive', severity: 'warning', facts: ['access-exclusive-conflicts', 'access-exclusive-blocks-select'], optional: ['lock-default-mode'] },
  { id: 'vacuum-full', severity: 'warning', facts: ['vacuum-full'] },
  { id: 'cluster', severity: 'warning', facts: ['cluster-lock'] },
  { id: 'missing-terminator', severity: 'warning', facts: [] },
  { id: 'unparsed-statement', severity: 'warning', facts: [] },
  { id: 'validate-constraint', severity: 'info', facts: ['validate-lock'] },
  { id: 'default-function-unclassified', severity: 'info', facts: ['add-column-nonvolatile-fast', 'add-column-volatile-rewrite'] },
  { id: 'do-block-not-read', severity: 'info', facts: [] },
  { id: 'meta-command', severity: 'info', facts: [] }
];

export const ORDER = Object.fromEntries(FINDINGS.map((f, i) => [f.id, i]));
const BY_ID = Object.fromEntries(FINDINGS.map((f) => [f.id, f]));

export function meetsThreshold(severity, failOn) {
  return RANK[severity] <= RANK[failOn];
}

// Ranges that are replaced: C0 and C1 controls, left-to-right and right-to-left marks, line and paragraph separators and
// the direction controls. Built from numbers so that the source stays plain ASCII.
const UNSAFE = new RegExp(`[${[[0, 31], [127, 159], [0x200e, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069]].map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g');

// Text that comes from a file goes through this before it reaches a message: control, line separator and direction
// characters become a space, and the length is cut.
export function safeText(value, max = 200) {
  const text = String(value).replace(UNSAFE, ' ');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

const isWord = (t, u) => t !== undefined && t.t === 'word' && (u === undefined || t.u === u);
const isPunct = (t, v) => t !== undefined && t.t === 'punct' && t.v === v;
const isName = (t) => t !== undefined && (t.t === 'word' || t.t === 'qident');

// A name, possibly qualified: a.b.c. Unquoted names are folded to lower case, quoted ones are kept as written. A
// name in the schema "public" is the same as the bare name, because public is on the search path by default.
export function readName(w, i) {
  if (!isName(w[i])) return null;
  const parts = [];
  const shown = [];
  let j = i;
  for (;;) {
    const t = w[j];
    parts.push(t.t === 'word' ? t.v.toLowerCase() : t.v);
    shown.push(t.v);
    j += 1;
    if (isPunct(w[j], '.') && isName(w[j + 1])) j += 1;
    else break;
  }
  const key = parts.length === 2 && parts[0] === 'public' ? parts[1] : parts.join('.');
  return { key, shown: safeText(shown.join('.'), 120), next: j };
}

// The tokens of one statement are balanced when every ( is closed.
function balanced(w) {
  let depth = 0;
  for (const t of w) {
    if (t.t !== 'punct') continue;
    if (t.v === '(') depth += 1;
    else if (t.v === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

// True when the token at i is at parenthesis depth 0, given the depth before the first token.
function depthMap(w) {
  const depth = new Array(w.length);
  let d = 0;
  for (let i = 0; i < w.length; i += 1) {
    if (isPunct(w[i], ')')) d -= 1;
    depth[i] = d < 0 ? 0 : d;
    if (isPunct(w[i], '(')) d += 1;
  }
  return depth;
}

// Splits at commas that are not inside parentheses.
function splitTop(w) {
  const out = [];
  let current = [];
  let d = 0;
  for (const t of w) {
    if (isPunct(t, '(')) d += 1;
    else if (isPunct(t, ')')) d -= 1;
    if (d === 0 && isPunct(t, ',')) {
      out.push(current);
      current = [];
    } else current.push(t);
  }
  out.push(current);
  return out.filter((s) => s.length > 0);
}

const hasTopWord = (w, depth, word) => w.some((t, i) => depth[i] === 0 && isWord(t, word));

// The state that the checks keep from one statement to the next: the tables that this set created, whether a transaction
// block is open, the CHECK (column IS NOT NULL) NOT VALID constraints that were added and not yet validated, and the
// columns that have such a constraint validated (so that SET NOT NULL can skip the scan, as the manual says).
export function createState() {
  return { newTables: new Set(), inTransaction: false, transactionLine: 0, pendingChecks: new Map(), provenNotNull: new Map() };
}

const keyOf = (t) => (t.t === 'word' ? t.v.toLowerCase() : t.v);

// The words that cannot be a function call in a DEFAULT: syntax that has parentheses after it.
const NOT_A_CALL = new Set(['CAST', 'COALESCE', 'NULLIF', 'GREATEST', 'LEAST', 'ROW', 'EXTRACT', 'ARRAY', 'EXISTS', 'CASE', 'IN', 'AND', 'OR', 'NOT', 'ANY', 'ALL', 'SOME', 'VARCHAR', 'CHAR', 'CHARACTER', 'NUMERIC', 'DECIMAL', 'TIMESTAMP', 'TIMESTAMPTZ', 'TIME', 'TIMETZ', 'INTERVAL', 'BIT', 'VARYING', 'AS', 'DEFAULT', 'VALUES', 'SELECT', 'WHEN', 'THEN', 'ELSE']);
const COLUMN_BREAK = new Set(['NOT', 'NULL', 'CONSTRAINT', 'CHECK', 'UNIQUE', 'PRIMARY', 'REFERENCES', 'GENERATED', 'COLLATE', 'DEFAULT']);
const SERIAL = new Set(['SERIAL', 'BIGSERIAL', 'SMALLSERIAL', 'SERIAL2', 'SERIAL4', 'SERIAL8']);
const CONSTRAINT_START = new Set(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN', 'EXCLUDE', 'NOT', 'LIKE']);
const VOLATILE = new Map(VOLATILE_FUNCTIONS.map((f) => [f.name, f]));
const TRANSACTION_WORDS = new Set(['BEGIN', 'START', 'COMMIT', 'END', 'ABORT', 'ROLLBACK']);

function list(names, max = 6) {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

// Analyzes the statements of one file in order and calls emit(id, line, fields) for each finding. fields hold the
// statement kind, the table, the message and the fix. ctx = { state, emit, baseline }: in a baseline file the tables it
// creates are existing tables, not new ones.
export function analyzeStatements(statements, ctx) {
  const { state } = ctx;
  state.inTransaction = false;
  state.transactionLine = 0;
  const counts = { checked: 0, recognized: 0, unparsed: 0 };
  for (const st of statements) {
    const result = analyzeStatement(st, ctx);
    counts[result] += 1;
    if (!st.terminated) {
      ctx.emit('missing-terminator', st.tokens[st.tokens.length - 1].line, {
        statement: kindOf(st.tokens),
        table: null,
        message: 'The last statement of the file is not ended with a semicolon.',
        fix: 'End the statement with a semicolon, so that where it ends is not left to the tool that runs the file.'
      });
    }
  }
  return counts;
}

// The first word of a statement, as the name of its kind.
function kindOf(w) {
  return w[0].t === 'word' ? safeText(w[0].u, 40) : 'statement';
}

// Returns 'checked' when a check applies to the kind of statement, 'recognized' for a statement the tool understands
// but has no check for, and 'unparsed' for one that it could not read (a finding was reported).
function analyzeStatement(st, ctx) {
  const w = st.tokens;
  const first = w[0];
  const unparsed = (reason) => {
    ctx.emit('unparsed-statement', st.line, {
      statement: kindOf(w),
      table: null,
      message: `The statement could not be read: ${reason}. It was not checked.`,
      fix: 'Check the statement by hand, or write it in a form the tool reads (see docs/inputs.md).'
    });
    return 'unparsed';
  };
  if (!balanced(w)) return unparsed('its parentheses do not match');
  if (isPunct(first, '(')) return 'recognized';
  if (first.t !== 'word') return unparsed('it does not start with a keyword');
  if (!COMMAND_WORDS.has(first.u)) return unparsed(`it starts with ${safeText(first.v, 40)}, which is not the name of a command in the list of SQL commands of the manual`);

  switch (first.u) {
    case 'CREATE': return createStatement(w, ctx, st.line);
    case 'ALTER': return alterStatement(w, ctx, st.line);
    case 'DROP': return dropStatement(w, ctx, st.line);
    case 'TRUNCATE': return truncateStatement(w, ctx, st.line);
    case 'DELETE': return deleteStatement(w, ctx, st.line);
    case 'UPDATE': return updateStatement(w, ctx, st.line);
    case 'WITH': return withStatement(w, ctx);
    case 'LOCK': return lockStatement(w, ctx, st.line);
    case 'VACUUM': return vacuumStatement(w, ctx, st.line);
    case 'CLUSTER': return clusterStatement(w, ctx, st.line);
    case 'DO':
      ctx.emit('do-block-not-read', st.line, {
        statement: 'DO',
        table: null,
        message: 'The body of a DO block is not read, so a statement inside it is not checked.',
        fix: 'Write the statements in the migration file itself, outside the DO block, so that they are checked.'
      });
      return 'checked';
    default:
      if (TRANSACTION_WORDS.has(first.u)) transactionStatement(w, ctx, st.line);
      return 'recognized';
  }
}

function transactionStatement(w, ctx, line) {
  const { state } = ctx;
  const word = w[0].u;
  if (word === 'BEGIN' || (word === 'START' && isWord(w[1], 'TRANSACTION'))) {
    state.inTransaction = true;
    state.transactionLine = line;
    return;
  }
  if (word === 'START') return;
  if ((word === 'COMMIT' || word === 'ROLLBACK') && isWord(w[1], 'PREPARED')) return;
  if (word === 'ROLLBACK') {
    const k = isWord(w[1], 'WORK') || isWord(w[1], 'TRANSACTION') ? 2 : 1;
    if (isWord(w[k], 'TO')) return;
  }
  const chain = w.findIndex((t, i) => i > 0 && isWord(t, 'AND') && isWord(w[i + 1], 'CHAIN'));
  if (chain > 0) return;
  state.inTransaction = false;
}

const isNew = (state, key) => state.newTables.has(key);

function createStatement(w, ctx, line) {
  const { state } = ctx;
  let i = 1;
  while (isWord(w[i]) && ['OR', 'REPLACE', 'GLOBAL', 'LOCAL', 'TEMP', 'TEMPORARY', 'UNLOGGED', 'UNIQUE'].includes(w[i].u)) i += 1;
  if (isWord(w[i], 'TABLE')) {
    i += 1;
    if (isWord(w[i], 'IF') && isWord(w[i + 1], 'NOT') && isWord(w[i + 2], 'EXISTS')) i += 3;
    const name = readName(w, i);
    if (name && !ctx.baseline) state.newTables.add(name.key);
    return 'recognized';
  }
  if (!isWord(w[i], 'INDEX')) return 'recognized';
  i += 1;
  let concurrently = false;
  if (isWord(w[i], 'CONCURRENTLY')) {
    concurrently = true;
    i += 1;
  }
  if (isWord(w[i], 'IF') && isWord(w[i + 1], 'NOT') && isWord(w[i + 2], 'EXISTS')) i += 3;
  if (!isWord(w[i], 'ON') && isName(w[i])) i += 1;
  if (!isWord(w[i], 'ON')) {
    ctx.emit('unparsed-statement', line, {
      statement: 'CREATE INDEX',
      table: null,
      message: 'The statement could not be read: no ON table_name follows the index name. It was not checked.',
      fix: 'Check the statement by hand, or write it in the form the manual gives for CREATE INDEX.'
    });
    return 'unparsed';
  }
  i += 1;
  if (isWord(w[i], 'ONLY')) i += 1;
  const table = readName(w, i);
  if (!table) return 'recognized';
  if (concurrently && state.inTransaction) {
    ctx.emit('concurrently-in-transaction', line, {
      statement: 'CREATE INDEX CONCURRENTLY',
      table: table.shown,
      message: `CREATE INDEX CONCURRENTLY on ${table.shown} is written inside a transaction block (BEGIN at line ${state.transactionLine}). The manual says it cannot run in one, so the statement fails.`,
      fix: 'Move the statement out of the BEGIN ... COMMIT block, into a migration of its own that your tool does not wrap in a transaction.'
    });
    return 'checked';
  }
  if (!concurrently && !isNew(state, table.key)) {
    ctx.emit('index-not-concurrent', line, {
      statement: 'CREATE INDEX',
      table: table.shown,
      message: `CREATE INDEX on ${table.shown} is not CONCURRENTLY, so writes to ${table.shown} wait until the index is built.`,
      fix: 'Use CREATE INDEX CONCURRENTLY, in a migration that does not run inside a transaction block.'
    });
  }
  return 'checked';
}

// A statement with one action is reported at the line where the statement starts; with several actions, each action is
// reported at its own line.
function alterStatement(w, ctx, line) {
  const { state } = ctx;
  if (!isWord(w[1], 'TABLE')) return 'recognized';
  let i = 2;
  if (isWord(w[i], 'IF') && isWord(w[i + 1], 'EXISTS')) i += 2;
  if (isWord(w[i], 'ONLY')) i += 1;
  const table = readName(w, i);
  if (!table) return 'recognized';
  i = table.next;
  if (w[i] && w[i].t === 'op' && w[i].v === '*') i += 1;
  const rest = w.slice(i);
  if (!rest.length) return 'recognized';
  let checked = false;
  const actions = splitTop(rest);
  for (const action of actions) {
    if (alterAction(action, table, ctx, state, actions.length === 1 ? line : null)) checked = true;
  }
  return checked ? 'checked' : 'recognized';
}

// One action of ALTER TABLE. Returns true when a check applies to this kind of action.
function alterAction(s, table, ctx, state, statementLine) {
  const a = s[0];
  if (!isWord(a)) return false;
  const line = statementLine ?? a.line;
  const fresh = isNew(state, table.key);
  const t = table.shown;
  switch (a.u) {
    case 'ADD': {
      if (isWord(s[1]) && CONSTRAINT_START.has(s[1].u)) return addConstraint(s, 1, table, ctx, fresh, line);
      let k = 1;
      if (isWord(s[k], 'COLUMN')) k += 1;
      if (isWord(s[k], 'IF') && isWord(s[k + 1], 'NOT') && isWord(s[k + 2], 'EXISTS')) k += 3;
      if (!isName(s[k])) return false;
      if (!fresh) addColumn(s, k, table, ctx, line);
      return true;
    }
    case 'ALTER': {
      let k = 1;
      if (isWord(s[k], 'COLUMN')) k += 1;
      if (!isName(s[k])) return false;
      const col = safeText(s[k].v, 120);
      const rest = s.slice(k + 1);
      const isType = isWord(rest[0], 'TYPE') || (isWord(rest[0], 'SET') && isWord(rest[1], 'DATA') && isWord(rest[2], 'TYPE'));
      const isSetNotNull = isWord(rest[0], 'SET') && isWord(rest[1], 'NOT') && isWord(rest[2], 'NULL');
      if (!isType && !isSetNotNull) return false;
      if (fresh) return true;
      if (isSetNotNull && state.provenNotNull.get(table.key)?.has(keyOf(s[k]))) return true;
      if (isType) {
        ctx.emit('alter-column-type', line, {
          statement: 'ALTER TABLE ALTER COLUMN TYPE',
          table: t,
          message: `ALTER COLUMN ${col} TYPE can rewrite ${t} and its indexes. The manual says it will normally do so, except when the USING clause does not change the contents and the old type is binary coercible to the new one, which the tool cannot judge.`,
          fix: 'Add a column of the new type, copy the values in batches, move the application to it and drop the old column in a later migration; or confirm that this change needs no rewrite.'
        });
      } else {
        ctx.emit('set-not-null', line, {
          statement: 'ALTER TABLE ALTER COLUMN SET NOT NULL',
          table: t,
          message: `SET NOT NULL on ${col} scans all of ${t} to check that no row holds NULL, while the ALTER TABLE lock is held.`,
          fix: `Add CHECK (${col} IS NOT NULL) NOT VALID, run VALIDATE CONSTRAINT on it, then SET NOT NULL: the manual says the scan is skipped when a valid CHECK constraint proves that no NULL can exist.`
        });
      }
      return true;
    }
    case 'VALIDATE': {
      if (!isWord(s[1], 'CONSTRAINT') || !isName(s[2])) return false;
      const pending = state.pendingChecks.get(`${table.key}|${keyOf(s[2])}`);
      if (pending !== undefined) {
        if (!state.provenNotNull.has(table.key)) state.provenNotNull.set(table.key, new Set());
        state.provenNotNull.get(table.key).add(pending);
      }
      if (!fresh) {
        ctx.emit('validate-constraint', line, {
          statement: 'ALTER TABLE VALIDATE CONSTRAINT',
          table: t,
          message: `VALIDATE CONSTRAINT ${safeText(s[2].v, 120)} checks the existing rows of ${t}. It takes only a SHARE UPDATE EXCLUSIVE lock, so writes continue; it is the second step of the NOT VALID pattern.`,
          fix: 'No change is needed. Run it in a migration of its own, so that the scan does not hold up other changes.'
        });
      }
      return true;
    }
    case 'DROP': {
      if (isWord(s[1], 'CONSTRAINT')) return false;
      let k = 1;
      if (isWord(s[k], 'COLUMN')) k += 1;
      if (isWord(s[k], 'IF') && isWord(s[k + 1], 'EXISTS')) k += 2;
      if (!isName(s[k])) return false;
      if (!fresh) {
        ctx.emit('drop-column', line, {
          statement: 'ALTER TABLE DROP COLUMN',
          table: t,
          message: `DROP COLUMN ${safeText(s[k].v, 120)} on ${t} deletes the data of the column, and running application code that still reads or writes it fails.`,
          fix: 'Expand and contract: stop all reads and writes of the column in the application first, keep the column for one release, copy what you need elsewhere, and drop it in a later migration.'
        });
      }
      return true;
    }
    case 'RENAME': {
      if (isWord(s[1], 'CONSTRAINT')) return false;
      if (isWord(s[1], 'TO') && isName(s[2])) {
        const target = readName(s, 2);
        if (fresh) {
          state.newTables.delete(table.key);
          if (target && !ctx.baseline) state.newTables.add(target.key);
        } else {
          ctx.emit('rename-table', line, {
            statement: 'ALTER TABLE RENAME',
            table: t,
            message: `RENAME TO changes the name of ${t} to ${target ? target.shown : 'a new name'}. Running application code, and the version of it that is still deployed, uses the old name and fails.`,
            fix: 'Expand and contract: create the new name as a view or a second table, move the application over, and rename or drop the old one in a later migration; or rename only when no old version of the application is running.'
          });
        }
        return true;
      }
      let k = 1;
      if (isWord(s[k], 'COLUMN')) k += 1;
      if (!isName(s[k]) || !isWord(s[k + 1], 'TO') || !isName(s[k + 2])) return false;
      if (!fresh) {
        ctx.emit('rename-column', line, {
          statement: 'ALTER TABLE RENAME COLUMN',
          table: t,
          message: `RENAME COLUMN ${safeText(s[k].v, 120)} TO ${safeText(s[k + 2].v, 120)} on ${t}. Running application code, and the version of it that is still deployed, uses the old name and fails.`,
          fix: 'Expand and contract: add the new column, write to both, backfill, move the application to the new name, and drop the old column in a later migration; or rename only when no old version of the application is running.'
        });
      }
      return true;
    }
    default:
      return false;
  }
}

function addConstraint(s, k, table, ctx, fresh, line) {
  const named = isWord(s[k], 'CONSTRAINT') && isName(s[k + 1]) ? s[k + 1] : null;
  if (isWord(s[k], 'CONSTRAINT')) k += 2;
  const kind = s[k];
  if (!isWord(kind) || (kind.u !== 'FOREIGN' && kind.u !== 'CHECK')) return true;
  if (fresh) return true;
  const depth = depthMap(s);
  let notValid = false;
  let notEnforced = false;
  for (let i = 0; i < s.length - 1; i += 1) {
    if (depth[i] !== 0 || !isWord(s[i], 'NOT')) continue;
    if (isWord(s[i + 1], 'VALID')) notValid = true;
    if (isWord(s[i + 1], 'ENFORCED')) notEnforced = true;
  }
  if (notValid || notEnforced) {
    // CHECK (column IS NOT NULL) NOT VALID: remember it, so that a later VALIDATE CONSTRAINT proves the column.
    const body = s.slice(k + 1, k + 7);
    if (named && notValid && kind.u === 'CHECK' && isPunct(body[0], '(') && isName(body[1]) && isWord(body[2], 'IS') && isWord(body[3], 'NOT') && isWord(body[4], 'NULL') && isPunct(body[5], ')')) {
      ctx.state.pendingChecks.set(`${table.key}|${keyOf(named)}`, keyOf(body[1]));
    }
    return true;
  }
  const fk = kind.u === 'FOREIGN';
  ctx.emit('add-constraint-without-not-valid', line, {
    statement: 'ALTER TABLE ADD CONSTRAINT',
    table: table.shown,
    message: `ADD ${fk ? 'FOREIGN KEY' : 'CHECK'} constraint without NOT VALID scans all of ${table.shown} to check the existing rows, and updates to the table are locked out until the statement is committed.${fk ? ' A foreign key also takes a lock on the referenced table.' : ''}`,
    fix: 'Add the constraint with NOT VALID, then run ALTER TABLE ... VALIDATE CONSTRAINT in a separate statement.',
    extraFacts: fk ? ['foreign-key-lock'] : []
  });
  return true;
}

function addColumn(s, k, table, ctx, line) {
  const col = safeText(s[k].v, 120);
  const d = s.slice(k + 1);
  const depth = depthMap(d);
  const t = table.shown;
  const serial = isWord(d[0]) && SERIAL.has(d[0].u);
  let notNull = false;
  let identity = false;
  let stored = false;
  let defaultTokens = null;
  for (let i = 0; i < d.length; i += 1) {
    if (depth[i] !== 0 || !isWord(d[i])) continue;
    const u = d[i].u;
    if (u === 'NOT' && isWord(d[i + 1], 'NULL')) notNull = true;
    else if (u === 'IDENTITY') identity = true;
    else if (u === 'STORED') stored = true;
    else if (u === 'DEFAULT' && defaultTokens === null) {
      defaultTokens = [];
      let j = i + 1;
      while (j < d.length && !(depth[j] === 0 && isWord(d[j]) && COLUMN_BREAK.has(d[j].u))) {
        defaultTokens.push(d[j]);
        j += 1;
      }
    }
  }
  const hasDefault = defaultTokens !== null && defaultTokens.length > 0;
  if (notNull && !hasDefault && !identity && !stored && !serial) {
    ctx.emit('add-column-not-null-no-default', line, {
      statement: 'ALTER TABLE ADD COLUMN',
      table: t,
      message: `ADD COLUMN ${col} is NOT NULL and has no DEFAULT. The manual says a column without a default is filled with NULL and that a NOT NULL column cannot hold null values, so the statement fails when ${t} already has rows (this conclusion is the tool's own).`,
      fix: 'Add the column with a constant DEFAULT, or without NOT NULL, fill the existing rows in batches, and add NOT NULL in a later migration.'
    });
  }
  if (identity || stored) {
    ctx.emit('add-column-rewrite', line, {
      statement: 'ALTER TABLE ADD COLUMN',
      table: t,
      message: `ADD COLUMN ${col} is ${identity ? 'an identity column' : 'a stored generated column'}. The manual says this rewrites the entire table and its indexes, and the ALTER TABLE lock is held while it does.`,
      fix: 'Add a plain nullable column, fill it in batches, and make it an identity or generated column by another route; or run the migration in a maintenance window.'
    });
  }
  if (defaultTokens) {
    const calls = [];
    for (let i = 0; i < defaultTokens.length - 1; i += 1) {
      const tok = defaultTokens[i];
      if (!isWord(tok) || !isPunct(defaultTokens[i + 1], '(') || NOT_A_CALL.has(tok.u)) continue;
      const before = defaultTokens[i - 1];
      if (before && before.t === 'op' && before.v === ':') continue;
      calls.push(tok.v.toLowerCase());
    }
    const volatile = [...new Set(calls)].filter((c) => VOLATILE.has(c));
    const other = [...new Set(calls)].filter((c) => !VOLATILE.has(c));
    if (volatile.length) {
      ctx.emit('add-column-volatile-default', line, {
        statement: 'ALTER TABLE ADD COLUMN',
        table: t,
        message: `The DEFAULT of ADD COLUMN ${col} calls ${list(volatile.map((f) => `${safeText(f, 60)}()`))}, which the manual names as volatile. A volatile DEFAULT rewrites the entire table and its indexes.`,
        fix: 'Add the column without a default (or with a constant one), fill the existing rows in batches, then set the default for new rows with ALTER COLUMN ... SET DEFAULT.'
      });
    }
    if (other.length) emitUnclassified(ctx, line, t, col, other.map((f) => `${safeText(f, 60)}()`));
  } else if (serial) {
    emitUnclassified(ctx, line, t, col, ['nextval() (the serial type)']);
  }
}

function emitUnclassified(ctx, line, t, col, names) {
  ctx.emit('default-function-unclassified', line, {
    statement: 'ALTER TABLE ADD COLUMN',
    table: t,
    message: `The default of ADD COLUMN ${col} calls ${list(names)}. The manual says a non-volatile default is stored in the table's metadata and a volatile one rewrites the table; the tool names only ${VOLATILE_FUNCTIONS.map((f) => `${f.name}()`).join(', ')} as volatile and cannot tell which this is.`,
    fix: 'Check the volatility category of the function (VOLATILE, STABLE or IMMUTABLE); if it is volatile, add the column without a default and fill the rows in batches.'
  });
}

// A comma-separated list of table names, each with an optional ONLY before it and * after it. Returns the names and
// the index after the last one.
function readNames(w, i) {
  const names = [];
  for (;;) {
    if (isWord(w[i], 'ONLY')) i += 1;
    const name = readName(w, i);
    if (!name) break;
    names.push(name);
    i = name.next;
    if (w[i] && w[i].t === 'op' && w[i].v === '*') i += 1;
    if (isPunct(w[i], ',')) i += 1;
    else break;
  }
  return { names, next: i };
}

function dropStatement(w, ctx, line) {
  const { state } = ctx;
  if (!isWord(w[1], 'TABLE')) return 'recognized';
  let i = 2;
  if (isWord(w[i], 'IF') && isWord(w[i + 1], 'EXISTS')) i += 2;
  const { names } = readNames(w, i);
  if (!names.length) return 'recognized';
  const existing = names.filter((n) => !isNew(state, n.key));
  for (const n of names) state.newTables.delete(n.key);
  if (existing.length) {
    ctx.emit('drop-table', line, {
      statement: 'DROP TABLE',
      table: list(existing.map((n) => n.shown)),
      message: `DROP TABLE removes ${list(existing.map((n) => n.shown))} with its indexes, rules, triggers and constraints, and all of its data. Running application code that still reads or writes it fails.`,
      fix: 'Expand and contract: stop all reads and writes in the application first, keep the table for one release (or rename it out of the way), copy what you need elsewhere, and drop it in a later migration.'
    });
  }
  return 'checked';
}

function truncateStatement(w, ctx, line) {
  const { state } = ctx;
  let i = 1;
  if (isWord(w[i], 'TABLE')) i += 1;
  const { names } = readNames(w, i);
  if (!names.length) return 'recognized';
  const existing = names.filter((n) => !isNew(state, n.key));
  if (existing.length) {
    ctx.emit('truncate', line, {
      statement: 'TRUNCATE',
      table: list(existing.map((n) => n.shown)),
      message: `TRUNCATE removes all rows of ${list(existing.map((n) => n.shown))} and takes an ACCESS EXCLUSIVE lock on each table, which blocks all other concurrent operations on it.`,
      fix: 'Make sure that the data is meant to go. On a table that is in use, delete the rows in batches with a WHERE clause instead.'
    });
  }
  return 'checked';
}

function deleteStatement(w, ctx, line) {
  if (!isWord(w[1], 'FROM')) return 'recognized';
  let i = 2;
  if (isWord(w[i], 'ONLY')) i += 1;
  const table = readName(w, i);
  if (!table) return 'recognized';
  const depth = depthMap(w);
  if (!hasTopWord(w, depth, 'WHERE') && !isNew(ctx.state, table.key)) {
    ctx.emit('delete-without-where', line, {
      statement: 'DELETE',
      table: table.shown,
      message: `DELETE FROM ${table.shown} has no WHERE clause, so it deletes every row of the table.`,
      fix: 'Add a WHERE clause. If every row is meant to go, say so in a comment, and on a large table delete in batches.'
    });
  }
  return 'checked';
}

function updateStatement(w, ctx, line) {
  let i = 1;
  if (isWord(w[i], 'ONLY')) i += 1;
  const table = readName(w, i);
  if (!table) return 'recognized';
  const depth = depthMap(w);
  if (!hasTopWord(w, depth, 'SET')) return 'recognized';
  if (!hasTopWord(w, depth, 'WHERE') && !isNew(ctx.state, table.key)) {
    ctx.emit('update-without-where', line, {
      statement: 'UPDATE',
      table: table.shown,
      message: `UPDATE ${table.shown} has no WHERE clause, so it changes every row of the table.`,
      fix: 'Add a WHERE clause. If every row is meant to change, say so in a comment, and on a large table update in batches.'
    });
  }
  return 'checked';
}

// WITH ... DELETE and WITH ... UPDATE: the statement after the list of queries is checked as if it stood alone.
function withStatement(w, ctx) {
  let depth = 0;
  for (let i = 1; i < w.length; i += 1) {
    if (isPunct(w[i], '(')) depth += 1;
    else if (isPunct(w[i], ')')) {
      depth -= 1;
      if (depth === 0 && !isPunct(w[i + 1], ',') && i + 1 < w.length) {
        const main = w.slice(i + 1);
        if (isWord(main[0], 'DELETE')) return deleteStatement(main, ctx, main[0].line);
        if (isWord(main[0], 'UPDATE')) return updateStatement(main, ctx, main[0].line);
        return 'recognized';
      }
    }
  }
  return 'recognized';
}

function lockStatement(w, ctx, line) {
  let i = 1;
  if (isWord(w[i], 'TABLE')) i += 1;
  const { names, next } = readNames(w, i);
  if (!names.length) return 'recognized';
  let mode = null;
  if (isWord(w[next], 'IN')) {
    const words = [];
    let j = next + 1;
    while (isWord(w[j]) && w[j].u !== 'MODE') {
      words.push(w[j].u);
      j += 1;
    }
    mode = words.join(' ');
  }
  const explicit = mode !== null;
  if (explicit && mode !== LOCK_MODES.accessExclusive) return 'checked';
  const existing = names.filter((n) => !isNew(ctx.state, n.key));
  if (existing.length) {
    const shown = list(existing.map((n) => n.shown));
    ctx.emit('lock-table-access-exclusive', line, {
      statement: 'LOCK TABLE',
      table: shown,
      message: `LOCK TABLE ${shown} takes the ${LOCK_MODES.accessExclusive} lock${explicit ? '' : ' (no mode was given, so the manual says that this mode is used)'}, which conflicts with locks of all modes and blocks even a plain SELECT, until the transaction ends.`,
      fix: 'Take the weakest lock mode that does the job, or remove the statement when the command that follows takes the lock it needs by itself.',
      extraFacts: explicit ? [] : ['lock-default-mode']
    });
  }
  return 'checked';
}

function vacuumStatement(w, ctx, line) {
  let i = 1;
  let full = false;
  if (isPunct(w[i], '(')) {
    let depth = 0;
    let j = i;
    for (; j < w.length; j += 1) {
      if (isPunct(w[j], '(')) depth += 1;
      else if (isPunct(w[j], ')')) {
        depth -= 1;
        if (depth === 0) break;
      }
      if (depth === 1 && isWord(w[j], 'FULL')) {
        const value = w[j + 1];
        const off = isWord(value) && (value.u === 'FALSE' || value.u === 'OFF');
        if (!off) full = true;
      }
    }
    i = j + 1;
  } else {
    while (isWord(w[i]) && ['FULL', 'FREEZE', 'VERBOSE', 'ANALYZE'].includes(w[i].u)) {
      if (w[i].u === 'FULL') full = true;
      i += 1;
    }
  }
  if (!full) return 'checked';
  const { names } = readNames(w, i);
  const existing = names.filter((n) => !isNew(ctx.state, n.key));
  if (names.length && !existing.length) return 'checked';
  const shown = names.length ? list(existing.map((n) => n.shown)) : 'every table of the database';
  ctx.emit('vacuum-full', line, {
    statement: 'VACUUM FULL',
    table: names.length ? shown : null,
    message: `VACUUM FULL rewrites ${shown} into a new file and holds an ACCESS EXCLUSIVE lock on each table while it does.`,
    fix: 'Use a plain VACUUM, which does not take that lock, or run VACUUM FULL in a maintenance window when no application is using the table.'
  });
  return 'checked';
}

function clusterStatement(w, ctx, line) {
  let i = 1;
  if (isWord(w[i], 'VERBOSE')) i += 1;
  else if (isPunct(w[i], '(')) {
    let depth = 0;
    for (; i < w.length; i += 1) {
      if (isPunct(w[i], '(')) depth += 1;
      else if (isPunct(w[i], ')')) {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
    }
  }
  const table = readName(w, i);
  if (table && isNew(ctx.state, table.key)) return 'checked';
  ctx.emit('cluster', line, {
    statement: 'CLUSTER',
    table: table ? table.shown : null,
    message: `CLUSTER rewrites ${table ? table.shown : 'every table that was clustered before'} and holds an ACCESS EXCLUSIVE lock on it, so no other session can read or write the table until it is finished.`,
    fix: 'Run CLUSTER in a maintenance window when no application is using the table.'
  });
  return 'checked';
}

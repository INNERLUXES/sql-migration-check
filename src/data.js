// Every name and every quoted sentence that the checks rely on comes from a page of the PostgreSQL manual. The pages are
// saved as text in research/sources (the address is on the first line), and test/data.test.js compares this file with
// the saved text. Nothing here was written from memory: a sentence that is not on a saved page is not a fact of this file.

export const MANUAL_BASE = 'https://www.postgresql.org/docs/current/';

// id: used in FACTS; title: the heading of the page; page: the last part of the address; file: the saved text in research/sources.
export const SOURCES = [
  { id: 'create-index', title: 'CREATE INDEX', page: 'sql-createindex', file: 'postgresql-create-index.txt' },
  { id: 'alter-table', title: 'ALTER TABLE', page: 'sql-altertable', file: 'postgresql-alter-table.txt' },
  { id: 'create-table', title: 'CREATE TABLE', page: 'sql-createtable', file: 'postgresql-create-table.txt' },
  { id: 'explicit-locking', title: '13.3. Explicit Locking', page: 'explicit-locking', file: 'postgresql-explicit-locking.txt' },
  { id: 'drop-table', title: 'DROP TABLE', page: 'sql-droptable', file: 'postgresql-drop-table.txt' },
  { id: 'truncate', title: 'TRUNCATE', page: 'sql-truncate', file: 'postgresql-truncate.txt' },
  { id: 'delete', title: 'DELETE', page: 'sql-delete', file: 'postgresql-delete.txt' },
  { id: 'update', title: 'UPDATE', page: 'sql-update', file: 'postgresql-update.txt' },
  { id: 'lock', title: 'LOCK', page: 'sql-lock', file: 'postgresql-lock.txt' },
  { id: 'vacuum', title: 'VACUUM', page: 'sql-vacuum', file: 'postgresql-vacuum.txt' },
  { id: 'cluster', title: 'CLUSTER', page: 'sql-cluster', file: 'postgresql-cluster.txt' },
  { id: 'begin', title: 'BEGIN', page: 'sql-begin', file: 'postgresql-begin.txt' },
  { id: 'start-transaction', title: 'START TRANSACTION', page: 'sql-start-transaction', file: 'postgresql-start-transaction.txt' },
  { id: 'commit', title: 'COMMIT', page: 'sql-commit', file: 'postgresql-commit.txt' },
  { id: 'end', title: 'END', page: 'sql-end', file: 'postgresql-end.txt' },
  { id: 'rollback', title: 'ROLLBACK', page: 'sql-rollback', file: 'postgresql-rollback.txt' },
  { id: 'abort', title: 'ABORT', page: 'sql-abort', file: 'postgresql-abort.txt' },
  { id: 'rollback-to', title: 'ROLLBACK TO SAVEPOINT', page: 'sql-rollback-to', file: 'postgresql-rollback-to.txt' },
  { id: 'ddl-alter', title: '5.7. Modifying Tables', page: 'ddl-alter', file: 'postgresql-ddl-alter.txt' },
  { id: 'function-volatility', title: '36.7. Function Volatility Categories', page: 'xfunc-volatility', file: 'postgresql-function-volatility.txt' },
  { id: 'sql-commands', title: 'SQL Commands', page: 'sql-commands', file: 'postgresql-sql-commands.txt' },
  { id: 'select', title: 'SELECT', page: 'sql-select', file: 'postgresql-select.txt' }
].map((s) => ({ ...s, url: `${MANUAL_BASE}${s.page}.html` }));

export const sourceUrl = (id) => SOURCES.find((s) => s.id === id).url;

// The sentences that the findings quote. section is a heading of the saved page; text is copied from it.
export const FACTS = {
  'index-blocks-writes': {
    source: 'create-index',
    section: 'Parameters',
    text: "When this option is used, PostgreSQL will build the index without taking any locks that prevent concurrent inserts, updates, or deletes on the table; whereas a standard index build locks out writes (but not reads) on the table until it's done."
  },
  'index-concurrently-transaction': {
    source: 'create-index',
    section: 'Building Indexes Concurrently',
    text: 'Another difference is that a regular CREATE INDEX command can be performed within a transaction block, but CREATE INDEX CONCURRENTLY cannot.'
  },
  'add-column-null-default': {
    source: 'alter-table',
    section: 'Notes',
    text: 'If no column constraints are specified, NULL is used as the DEFAULT.'
  },
  'not-null-meaning': {
    source: 'create-table',
    section: 'Parameters',
    text: 'The column is not allowed to contain null values.'
  },
  'add-column-volatile-rewrite': {
    source: 'alter-table',
    section: 'Notes',
    text: 'Adding a column with a volatile DEFAULT (e.g., clock_timestamp()), a stored generated column, an identity column, or a column with a domain data type that has constraints will cause the entire table and its indexes to be rewritten.'
  },
  'add-column-nonvolatile-fast': {
    source: 'alter-table',
    section: 'Notes',
    text: "When a column is added with ADD COLUMN and a non-volatile DEFAULT is specified, the default value is evaluated at the time of the statement and the result stored in the table's metadata, where it will be returned when any existing rows are accessed."
  },
  'volatile-examples': {
    source: 'function-volatility',
    section: '36.7. Function Volatility Categories',
    text: 'Even a function with no side-effects needs to be labeled VOLATILE if its value can change within a single query; some examples are random(), currval(), timeofday().'
  },
  'alter-lock-level': {
    source: 'alter-table',
    section: 'Description',
    text: 'An ACCESS EXCLUSIVE lock is acquired unless explicitly noted.'
  },
  'set-default-new-rows': {
    source: 'alter-table',
    section: 'Description',
    text: 'The new default value will only apply in subsequent INSERT or UPDATE commands; it does not cause rows already in the table to change.'
  },
  'truncate-use-delete': {
    source: 'truncate',
    section: 'Notes',
    text: 'If concurrent access to a table is required, then the DELETE command should be used instead.'
  },
  'type-change-rewrite': {
    source: 'alter-table',
    section: 'Notes',
    text: 'Changing the type of an existing column will normally cause the entire table and its indexes to be rewritten.'
  },
  'rewrite-disk-and-time': {
    source: 'alter-table',
    section: 'Notes',
    text: 'Table and/or index rebuilds may take a significant amount of time for a large table, and will temporarily require as much as double the disk space.'
  },
  'set-not-null-scan': {
    source: 'alter-table',
    section: 'Description',
    text: 'Ordinarily this is checked during the ALTER TABLE by scanning the entire table, unless NOT VALID is specified; however, if a valid CHECK constraint exists (and is not dropped in the same command) which proves no NULL can exist, then the table scan is skipped.'
  },
  'add-constraint-scan-lock': {
    source: 'alter-table',
    section: 'Notes',
    text: 'Scanning a large table to verify new foreign-key, check, or not-null constraints can take a long time, and other updates to the table are locked out until the ALTER TABLE ADD CONSTRAINT command is committed.'
  },
  'not-valid-pattern': {
    source: 'alter-table',
    section: 'Notes',
    text: 'With NOT VALID, the ADD CONSTRAINT command does not scan the table and can be committed immediately. After that, a VALIDATE CONSTRAINT command can be issued to verify that existing rows satisfy the constraint.'
  },
  'validate-lock': {
    source: 'alter-table',
    section: 'Notes',
    text: 'The validation step does not need to lock out concurrent updates, since it knows that other transactions will be enforcing the constraint for rows that they insert or update; only pre-existing rows need to be checked. Hence, validation acquires only a SHARE UPDATE EXCLUSIVE lock on the table being altered.'
  },
  'foreign-key-lock': {
    source: 'alter-table',
    section: 'Description',
    text: 'Although most forms of ADD table_constraint require an ACCESS EXCLUSIVE lock, ADD FOREIGN KEY requires only a SHARE ROW EXCLUSIVE lock.'
  },
  'not-enforced-no-scan': {
    source: 'alter-table',
    section: 'Notes',
    text: 'If a CHECK constraint is added as NOT ENFORCED, no verification will be performed.'
  },
  'drop-table': {
    source: 'drop-table',
    section: 'Description',
    text: 'DROP TABLE always removes any indexes, rules, triggers, and constraints that exist for the target table.'
  },
  'drop-column': {
    source: 'ddl-alter',
    section: '5.7.2. Removing a Column',
    text: 'Whatever data was in the column disappears. Table constraints involving the column are dropped, too.'
  },
  'truncate-removes-rows': {
    source: 'truncate',
    section: 'Description',
    text: 'TRUNCATE quickly removes all rows from a set of tables.'
  },
  'truncate-lock': {
    source: 'truncate',
    section: 'Notes',
    text: 'TRUNCATE acquires an ACCESS EXCLUSIVE lock on each table it operates on, which blocks all other concurrent operations on the table.'
  },
  'delete-all-rows': {
    source: 'delete',
    section: 'Description',
    text: 'If the WHERE clause is absent, the effect is to delete all rows in the table.'
  },
  'update-condition': {
    source: 'update',
    section: 'Parameters',
    text: 'Only rows for which this expression returns true will be updated.'
  },
  'rename-forms': {
    source: 'alter-table',
    section: 'Description',
    text: 'The RENAME forms change the name of a table (or an index, sequence, view, materialized view, or foreign table), the name of an individual column in a table, or the name of a constraint of the table.'
  },
  'lock-default-mode': {
    source: 'lock',
    section: 'Parameters',
    text: 'If no lock mode is specified, then ACCESS EXCLUSIVE, the most restrictive mode, is used.'
  },
  'access-exclusive-conflicts': {
    source: 'explicit-locking',
    section: '13.3.1. Table-Level Locks',
    text: 'Conflicts with locks of all modes (ACCESS SHARE, ROW SHARE, ROW EXCLUSIVE, SHARE UPDATE EXCLUSIVE, SHARE, SHARE ROW EXCLUSIVE, EXCLUSIVE, and ACCESS EXCLUSIVE). This mode guarantees that the holder is the only transaction accessing the table in any way.'
  },
  'access-exclusive-blocks-select': {
    source: 'explicit-locking',
    section: '13.3.1. Table-Level Locks',
    text: 'Only an ACCESS EXCLUSIVE lock blocks a SELECT (without FOR UPDATE/SHARE) statement.'
  },
  'access-exclusive-commands': {
    source: 'explicit-locking',
    section: '13.3.1. Table-Level Locks',
    text: 'Acquired by the DROP TABLE, TRUNCATE, REINDEX, CLUSTER, VACUUM FULL, and REFRESH MATERIALIZED VIEW (without CONCURRENTLY) commands.'
  },
  'vacuum-full': {
    source: 'vacuum',
    section: 'Description',
    text: 'VACUUM FULL rewrites the entire contents of the table into a new disk file with no extra space, allowing unused space to be returned to the operating system. This form is much slower and requires an ACCESS EXCLUSIVE lock on each table while it is being processed.'
  },
  'cluster-lock': {
    source: 'cluster',
    section: 'Description',
    text: 'When a table is being clustered, an ACCESS EXCLUSIVE lock is acquired on it. This prevents any other database operations (both reads and writes) from operating on the table until the CLUSTER is finished.'
  },
  'transaction-block': {
    source: 'begin',
    section: 'Description',
    text: 'BEGIN initiates a transaction block, that is, all statements after a BEGIN command will be executed in a single transaction until an explicit COMMIT or ROLLBACK is given.'
  }
};

// The lock mode names that the messages use; each is on the page of the manual that lists the lock modes.
export const LOCK_MODES = {
  accessExclusive: 'ACCESS EXCLUSIVE',
  shareRowExclusive: 'SHARE ROW EXCLUSIVE',
  shareUpdateExclusive: 'SHARE UPDATE EXCLUSIVE'
};

// Functions that the manual names as volatile: clock_timestamp() on the ALTER TABLE page, the other three on the page
// about function volatility. A DEFAULT that calls one of them rewrites the table when the column is added. Other
// functions are not classified by the tool (see docs/method.md).
export const VOLATILE_FUNCTIONS = [
  { name: 'clock_timestamp', source: 'alter-table' },
  { name: 'random', source: 'function-volatility' },
  { name: 'currval', source: 'function-volatility' },
  { name: 'timeofday', source: 'function-volatility' }
];

// The statements that open or close a transaction block, each with the heading of its page in the manual.
export const TRANSACTION_COMMANDS = [
  { words: 'BEGIN', source: 'begin', heading: 'BEGIN' },
  { words: 'START TRANSACTION', source: 'start-transaction', heading: 'START TRANSACTION' },
  { words: 'COMMIT', source: 'commit', heading: 'COMMIT' },
  { words: 'END', source: 'end', heading: 'END' },
  { words: 'ROLLBACK', source: 'rollback', heading: 'ROLLBACK' },
  { words: 'ABORT', source: 'abort', heading: 'ABORT' },
  { words: 'ROLLBACK TO', source: 'rollback-to', heading: 'ROLLBACK TO SAVEPOINT' }
];

// Words that start a statement the tool recognizes: the first word of every command in the list of SQL commands of the
// manual (page sql-commands), and WITH and TABLE, which start a form of SELECT (page select). A statement that
// starts with another word is reported as not understood, never skipped silently.
export const COMMAND_WORDS = new Set([
  'ABORT', 'ALTER', 'ANALYZE', 'BEGIN', 'CALL', 'CHECKPOINT', 'CLOSE', 'CLUSTER', 'COMMENT', 'COMMIT', 'COPY', 'CREATE',
  'DEALLOCATE', 'DECLARE', 'DELETE', 'DISCARD', 'DO', 'DROP', 'END', 'EXECUTE', 'EXPLAIN', 'FETCH', 'GRANT', 'IMPORT', 'INSERT',
  'LISTEN', 'LOAD', 'LOCK', 'MERGE', 'MOVE', 'NOTIFY', 'PREPARE', 'REASSIGN', 'REFRESH', 'REINDEX', 'RELEASE', 'RESET', 'REVOKE',
  'ROLLBACK', 'SAVEPOINT', 'SECURITY', 'SELECT', 'SET', 'SHOW', 'START', 'TABLE', 'TRUNCATE', 'UNLISTEN', 'UPDATE', 'VACUUM',
  'VALUES', 'WITH'
]);

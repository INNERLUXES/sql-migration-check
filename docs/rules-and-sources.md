# Rules and sources

Every name and every quoted sentence that the tool relies on comes from a page of the PostgreSQL manual, which is saved as text in [research/sources](../research/sources) with its address on the first line. `test/data.test.js` compares them: each sentence below must be on the saved page it names, under the heading it names, word for word, and the lock names, the function names, the statement words and the syntax that the checks read must be on the saved pages. The tool quotes the manual; it does not paraphrase it. Where a finding draws a conclusion that no sentence states, the message says that the conclusion is its own.

The pages are the ones of the manual that the address `https://www.postgresql.org/docs/current/` serves. The syntax shown on those pages is the syntax that the tool reads. A construct that the saved pages do not describe is not checked, and a construct that a page of another version of PostgreSQL describes differently is read the way the saved page describes it.

## Pages

| Heading | Address | Saved as |
| --- | --- | --- |
| CREATE INDEX | https://www.postgresql.org/docs/current/sql-createindex.html | research/sources/postgresql-create-index.txt |
| ALTER TABLE | https://www.postgresql.org/docs/current/sql-altertable.html | research/sources/postgresql-alter-table.txt |
| CREATE TABLE | https://www.postgresql.org/docs/current/sql-createtable.html | research/sources/postgresql-create-table.txt |
| 13.3. Explicit Locking | https://www.postgresql.org/docs/current/explicit-locking.html | research/sources/postgresql-explicit-locking.txt |
| DROP TABLE | https://www.postgresql.org/docs/current/sql-droptable.html | research/sources/postgresql-drop-table.txt |
| TRUNCATE | https://www.postgresql.org/docs/current/sql-truncate.html | research/sources/postgresql-truncate.txt |
| DELETE | https://www.postgresql.org/docs/current/sql-delete.html | research/sources/postgresql-delete.txt |
| UPDATE | https://www.postgresql.org/docs/current/sql-update.html | research/sources/postgresql-update.txt |
| LOCK | https://www.postgresql.org/docs/current/sql-lock.html | research/sources/postgresql-lock.txt |
| VACUUM | https://www.postgresql.org/docs/current/sql-vacuum.html | research/sources/postgresql-vacuum.txt |
| CLUSTER | https://www.postgresql.org/docs/current/sql-cluster.html | research/sources/postgresql-cluster.txt |
| BEGIN | https://www.postgresql.org/docs/current/sql-begin.html | research/sources/postgresql-begin.txt |
| START TRANSACTION | https://www.postgresql.org/docs/current/sql-start-transaction.html | research/sources/postgresql-start-transaction.txt |
| COMMIT | https://www.postgresql.org/docs/current/sql-commit.html | research/sources/postgresql-commit.txt |
| END | https://www.postgresql.org/docs/current/sql-end.html | research/sources/postgresql-end.txt |
| ROLLBACK | https://www.postgresql.org/docs/current/sql-rollback.html | research/sources/postgresql-rollback.txt |
| ABORT | https://www.postgresql.org/docs/current/sql-abort.html | research/sources/postgresql-abort.txt |
| ROLLBACK TO SAVEPOINT | https://www.postgresql.org/docs/current/sql-rollback-to.html | research/sources/postgresql-rollback-to.txt |
| 5.7. Modifying Tables | https://www.postgresql.org/docs/current/ddl-alter.html | research/sources/postgresql-ddl-alter.txt |
| 36.7. Function Volatility Categories | https://www.postgresql.org/docs/current/xfunc-volatility.html | research/sources/postgresql-function-volatility.txt |
| SQL Commands | https://www.postgresql.org/docs/current/sql-commands.html | research/sources/postgresql-sql-commands.txt |
| SELECT | https://www.postgresql.org/docs/current/sql-select.html | research/sources/postgresql-select.txt |

## What each check rests on

| Check | Sentence of the manual | Page and heading |
| --- | --- | --- |
| `unterminated-token` | none: this check is about the file itself, not about a statement of the manual | - |
| `limit-reached` | none: this check is about the file itself, not about a statement of the manual | - |
| `concurrently-in-transaction` | "Another difference is that a regular CREATE INDEX command can be performed within a transaction block, but CREATE INDEX CONCURRENTLY cannot." | [CREATE INDEX, Building Indexes Concurrently](https://www.postgresql.org/docs/current/sql-createindex.html) |
|  | "BEGIN initiates a transaction block, that is, all statements after a BEGIN command will be executed in a single transaction until an explicit COMMIT or ROLLBACK is given." | [BEGIN, Description](https://www.postgresql.org/docs/current/sql-begin.html) |
| `add-column-not-null-no-default` | "If no column constraints are specified, NULL is used as the DEFAULT." | [ALTER TABLE, Notes](https://www.postgresql.org/docs/current/sql-altertable.html) |
|  | "The column is not allowed to contain null values." | [CREATE TABLE, Parameters](https://www.postgresql.org/docs/current/sql-createtable.html) |
| `drop-table` | "DROP TABLE always removes any indexes, rules, triggers, and constraints that exist for the target table." | [DROP TABLE, Description](https://www.postgresql.org/docs/current/sql-droptable.html) |
|  | "Acquired by the DROP TABLE, TRUNCATE, REINDEX, CLUSTER, VACUUM FULL, and REFRESH MATERIALIZED VIEW (without CONCURRENTLY) commands." | [13.3. Explicit Locking, 13.3.1. Table-Level Locks](https://www.postgresql.org/docs/current/explicit-locking.html) |
| `drop-column` | "Whatever data was in the column disappears. Table constraints involving the column are dropped, too." | [5.7. Modifying Tables, 5.7.2. Removing a Column](https://www.postgresql.org/docs/current/ddl-alter.html) |
| `truncate` | "TRUNCATE quickly removes all rows from a set of tables." | [TRUNCATE, Description](https://www.postgresql.org/docs/current/sql-truncate.html) |
|  | "TRUNCATE acquires an ACCESS EXCLUSIVE lock on each table it operates on, which blocks all other concurrent operations on the table." | [TRUNCATE, Notes](https://www.postgresql.org/docs/current/sql-truncate.html) |
|  | "If concurrent access to a table is required, then the DELETE command should be used instead." | [TRUNCATE, Notes](https://www.postgresql.org/docs/current/sql-truncate.html) |
| `delete-without-where` | "If the WHERE clause is absent, the effect is to delete all rows in the table." | [DELETE, Description](https://www.postgresql.org/docs/current/sql-delete.html) |
| `update-without-where` | "Only rows for which this expression returns true will be updated." | [UPDATE, Parameters](https://www.postgresql.org/docs/current/sql-update.html) |
| `index-not-concurrent` | "When this option is used, PostgreSQL will build the index without taking any locks that prevent concurrent inserts, updates, or deletes on the table; whereas a standard index build locks out writes (but not reads) on the table until it's done." | [CREATE INDEX, Parameters](https://www.postgresql.org/docs/current/sql-createindex.html) |
| `add-column-volatile-default` | "Adding a column with a volatile DEFAULT (e.g., clock_timestamp()), a stored generated column, an identity column, or a column with a domain data type that has constraints will cause the entire table and its indexes to be rewritten." | [ALTER TABLE, Notes](https://www.postgresql.org/docs/current/sql-altertable.html) |
|  | "Even a function with no side-effects needs to be labeled VOLATILE if its value can change within a single query; some examples are random(), currval(), timeofday()." | [36.7. Function Volatility Categories, 36.7. Function Volatility Categories](https://www.postgresql.org/docs/current/xfunc-volatility.html) |
|  | "The new default value will only apply in subsequent INSERT or UPDATE commands; it does not cause rows already in the table to change." | [ALTER TABLE, Description](https://www.postgresql.org/docs/current/sql-altertable.html) |
| `add-column-rewrite` | "Adding a column with a volatile DEFAULT (e.g., clock_timestamp()), a stored generated column, an identity column, or a column with a domain data type that has constraints will cause the entire table and its indexes to be rewritten." | [ALTER TABLE, Notes](https://www.postgresql.org/docs/current/sql-altertable.html) |
|  | "An ACCESS EXCLUSIVE lock is acquired unless explicitly noted." | [ALTER TABLE, Description](https://www.postgresql.org/docs/current/sql-altertable.html) |
| `alter-column-type` | "Changing the type of an existing column will normally cause the entire table and its indexes to be rewritten." | [ALTER TABLE, Notes](https://www.postgresql.org/docs/current/sql-altertable.html) |
|  | "An ACCESS EXCLUSIVE lock is acquired unless explicitly noted." | [ALTER TABLE, Description](https://www.postgresql.org/docs/current/sql-altertable.html) |
|  | "Table and/or index rebuilds may take a significant amount of time for a large table, and will temporarily require as much as double the disk space." | [ALTER TABLE, Notes](https://www.postgresql.org/docs/current/sql-altertable.html) |
| `set-not-null` | "Ordinarily this is checked during the ALTER TABLE by scanning the entire table, unless NOT VALID is specified; however, if a valid CHECK constraint exists (and is not dropped in the same command) which proves no NULL can exist, then the table scan is skipped." | [ALTER TABLE, Description](https://www.postgresql.org/docs/current/sql-altertable.html) |
|  | "An ACCESS EXCLUSIVE lock is acquired unless explicitly noted." | [ALTER TABLE, Description](https://www.postgresql.org/docs/current/sql-altertable.html) |
|  | "With NOT VALID, the ADD CONSTRAINT command does not scan the table and can be committed immediately. After that, a VALIDATE CONSTRAINT command can be issued to verify that existing rows satisfy the constraint." | [ALTER TABLE, Notes](https://www.postgresql.org/docs/current/sql-altertable.html) |
| `add-constraint-without-not-valid` | "Scanning a large table to verify new foreign-key, check, or not-null constraints can take a long time, and other updates to the table are locked out until the ALTER TABLE ADD CONSTRAINT command is committed." | [ALTER TABLE, Notes](https://www.postgresql.org/docs/current/sql-altertable.html) |
|  | "With NOT VALID, the ADD CONSTRAINT command does not scan the table and can be committed immediately. After that, a VALIDATE CONSTRAINT command can be issued to verify that existing rows satisfy the constraint." | [ALTER TABLE, Notes](https://www.postgresql.org/docs/current/sql-altertable.html) |
|  | "Although most forms of ADD table_constraint require an ACCESS EXCLUSIVE lock, ADD FOREIGN KEY requires only a SHARE ROW EXCLUSIVE lock." | [ALTER TABLE, Description](https://www.postgresql.org/docs/current/sql-altertable.html) |
| `rename-column` | "The RENAME forms change the name of a table (or an index, sequence, view, materialized view, or foreign table), the name of an individual column in a table, or the name of a constraint of the table." | [ALTER TABLE, Description](https://www.postgresql.org/docs/current/sql-altertable.html) |
| `rename-table` | "The RENAME forms change the name of a table (or an index, sequence, view, materialized view, or foreign table), the name of an individual column in a table, or the name of a constraint of the table." | [ALTER TABLE, Description](https://www.postgresql.org/docs/current/sql-altertable.html) |
| `lock-table-access-exclusive` | "Conflicts with locks of all modes (ACCESS SHARE, ROW SHARE, ROW EXCLUSIVE, SHARE UPDATE EXCLUSIVE, SHARE, SHARE ROW EXCLUSIVE, EXCLUSIVE, and ACCESS EXCLUSIVE). This mode guarantees that the holder is the only transaction accessing the table in any way." | [13.3. Explicit Locking, 13.3.1. Table-Level Locks](https://www.postgresql.org/docs/current/explicit-locking.html) |
|  | "Only an ACCESS EXCLUSIVE lock blocks a SELECT (without FOR UPDATE/SHARE) statement." | [13.3. Explicit Locking, 13.3.1. Table-Level Locks](https://www.postgresql.org/docs/current/explicit-locking.html) |
|  | "If no lock mode is specified, then ACCESS EXCLUSIVE, the most restrictive mode, is used." | [LOCK, Parameters](https://www.postgresql.org/docs/current/sql-lock.html) |
| `vacuum-full` | "VACUUM FULL rewrites the entire contents of the table into a new disk file with no extra space, allowing unused space to be returned to the operating system. This form is much slower and requires an ACCESS EXCLUSIVE lock on each table while it is being processed." | [VACUUM, Description](https://www.postgresql.org/docs/current/sql-vacuum.html) |
| `cluster` | "When a table is being clustered, an ACCESS EXCLUSIVE lock is acquired on it. This prevents any other database operations (both reads and writes) from operating on the table until the CLUSTER is finished." | [CLUSTER, Description](https://www.postgresql.org/docs/current/sql-cluster.html) |
| `missing-terminator` | none: this check is about the file itself, not about a statement of the manual | - |
| `unparsed-statement` | none: this check is about the file itself, not about a statement of the manual | - |
| `validate-constraint` | "The validation step does not need to lock out concurrent updates, since it knows that other transactions will be enforcing the constraint for rows that they insert or update; only pre-existing rows need to be checked. Hence, validation acquires only a SHARE UPDATE EXCLUSIVE lock on the table being altered." | [ALTER TABLE, Notes](https://www.postgresql.org/docs/current/sql-altertable.html) |
| `default-function-unclassified` | "When a column is added with ADD COLUMN and a non-volatile DEFAULT is specified, the default value is evaluated at the time of the statement and the result stored in the table's metadata, where it will be returned when any existing rows are accessed." | [ALTER TABLE, Notes](https://www.postgresql.org/docs/current/sql-altertable.html) |
|  | "Adding a column with a volatile DEFAULT (e.g., clock_timestamp()), a stored generated column, an identity column, or a column with a domain data type that has constraints will cause the entire table and its indexes to be rewritten." | [ALTER TABLE, Notes](https://www.postgresql.org/docs/current/sql-altertable.html) |
| `do-block-not-read` | none: this check is about the file itself, not about a statement of the manual | - |
| `meta-command` | none: this check is about the file itself, not about a statement of the manual | - |

## Sentences that decide when a check does not report

| Check | Sentence of the manual | Page and heading |
| --- | --- | --- |
| `add-constraint-without-not-valid` | "If a CHECK constraint is added as NOT ENFORCED, no verification will be performed." | [ALTER TABLE, Notes](https://www.postgresql.org/docs/current/sql-altertable.html) |

## Words that are not from the manual

- **New table**, **existing table**, **baseline** and the way the tool decides them are the tool's own, described in [method.md](method.md).
- **Expand and contract** is a practice, not a sentence of the manual.
- The four function names that the tool calls volatile (`clock_timestamp`, `random`, `currval`, `timeofday`) are the ones the manual names as volatile; the volatility of any other function is not decided.
- The words that start a statement the tool knows are the first words of the commands in the manual's list of SQL commands, and `WITH` and `TABLE`, which start a form of `SELECT`.

# Method

The tool answers one question about a set of PostgreSQL migration files: which statements can lock a table, lose data or break application code that is running while the migration is applied? It reads the files as text, never connects to a database, and turns each thing it finds into a finding with a file and a line, a severity, the kind of statement, a message, a fix and the sentences of the PostgreSQL manual that the finding rests on.

A migration file does not say how big the tables are, whether the application is running, or how the migration is run. Every check below therefore says what it can see and what it cannot, and where the tool draws a conclusion of its own that the manual does not state, the message says so.

## Severities

- **error**: the statement fails, or it deletes data, or it can never succeed as written. `CREATE INDEX CONCURRENTLY` inside `BEGIN` ... `COMMIT`, a `NOT NULL` column added without a default, `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE` and `UPDATE` without `WHERE`, and a file that the tool could not read to the end.
- **warning**: the statement can hold a lock that blocks other sessions, rewrite or scan the whole table, or break running code. A plain `CREATE INDEX`, a type change, `SET NOT NULL`, a constraint without `NOT VALID`, a rename, `LOCK TABLE` at `ACCESS EXCLUSIVE`, `VACUUM FULL`, `CLUSTER`, a statement without its closing semicolon, a statement the tool could not read.
- **info**: something worth knowing that is not a gap by itself: `VALIDATE CONSTRAINT`, a default that the tool cannot classify, a `DO` block that is not read, a psql command.

By default only errors fail the run. `--fail-on warning` fails on warnings too. Info never fails the run.

## Which table a statement is about

Every check that is about a table in use is skipped for a **new table**: a table that an earlier statement of the same migration set created with `CREATE TABLE` (also `IF NOT EXISTS`, `TEMPORARY`, `UNLOGGED` and a partition). Nobody else uses such a table when the set is applied from the start, and it holds no rows, so a lock on it blocks nothing, a rewrite has nothing to rewrite, and a `NOT NULL` column without a default cannot fail. This is the tool's own decision, not a sentence of the manual.

- The order is the order of the statements: the files in the order they are read, and the statements in a file from top to bottom. A table created after the statement is not new for it.
- `DROP TABLE` ends the life of the table: a later statement on the same name is about an existing table until `CREATE TABLE` runs again.
- `ALTER TABLE ... RENAME TO` keeps the table new under its new name.
- Names are compared as PostgreSQL compares them: an unquoted name is folded to lower case, a quoted name is kept as written, and `public.rooms` is the same as `rooms` because `public` is on the search path by default. Any other schema name is part of the name.
- The files of a set that have **already been applied** are not new. Give `--since <file>`: the files before it are read only to learn which tables exist, and every table they create is an existing table. Nothing in those files is reported. Without `--since` a set that is applied from an empty database is assumed.

A statement on a table that no statement of the set created is a statement on an existing table.

## Transactions

The tool follows `BEGIN`, `START TRANSACTION`, `COMMIT`, `END`, `ROLLBACK` and `ABORT` inside one file, and nothing else. A transaction that is still open at the end of a file is taken as closed when the next file starts. `ROLLBACK TO SAVEPOINT` and `COMMIT AND CHAIN` do not leave the transaction. `COMMIT PREPARED` and `ROLLBACK PREPARED` do not change it. A migration tool that wraps every file in a transaction by itself is not seen: the tool reports `concurrently-in-transaction` only when the file itself says `BEGIN`.

## The checks

Each row gives the rule, the manual sentence it rests on (the quoted sentences are in [rules-and-sources.md](rules-and-sources.md)), and what the tool cannot see.

### `index-not-concurrent` (warning)

`CREATE INDEX` or `CREATE UNIQUE INDEX` without `CONCURRENTLY` on an existing table. Rests on: "a standard index build locks out writes (but not reads) on the table until it's done". Cannot see: how big the table is, so a small table is reported too, and whether the migration runner allows a file that is not wrapped in a transaction.

### `concurrently-in-transaction` (error)

`CREATE INDEX CONCURRENTLY` after `BEGIN` or `START TRANSACTION` and before the transaction ends, in the same file. Rests on: "a regular CREATE INDEX command can be performed within a transaction block, but CREATE INDEX CONCURRENTLY cannot". Reported for new tables too, because the statement fails whatever the table.

### `add-column-not-null-no-default` (error)

`ALTER TABLE ... ADD [COLUMN] name type ... NOT NULL` with no `DEFAULT`, on an existing table. The column is not an identity column, a stored generated column or a serial type, which fill themselves. Rests on two sentences: "If no column constraints are specified, NULL is used as the DEFAULT." and "The column is not allowed to contain null values." The conclusion that the statement fails when the table has rows is the tool's own. `DEFAULT NULL` counts as no default. Cannot see: that the table is empty.

### `add-column-volatile-default` (warning)

`ADD COLUMN` whose `DEFAULT` calls `clock_timestamp`, `random`, `currval` or `timeofday`. Rests on: "Adding a column with a volatile DEFAULT (e.g., clock_timestamp()), a stored generated column, an identity column, or a column with a domain data type that has constraints will cause the entire table and its indexes to be rewritten." The four names are the ones that the manual itself calls volatile; the tool does not know any other function's category. A call inside a cast (`::numeric(10,2)`) or a keyword with parentheses (`COALESCE`, `CAST`) is not a call.

### `default-function-unclassified` (info)

`ADD COLUMN` whose default calls a function that is not one of the four, or whose type is `serial`, `bigserial` or `smallserial`. The manual says a non-volatile default is stored in the metadata and a volatile one rewrites the table; the tool cannot tell which category the function has, and says so. Info only, so it never fails the run.

### `add-column-rewrite` (warning)

`ADD COLUMN` of an identity column (`GENERATED ... AS IDENTITY`) or a stored generated column (`STORED`). Rests on the same sentence as `add-column-volatile-default`. A virtual generated column is not reported: the manual says that adding one never requires a rewrite.

### `alter-column-type` (warning)

`ALTER [COLUMN] name TYPE ...` and `ALTER [COLUMN] name SET DATA TYPE ...`. Rests on: "Changing the type of an existing column will normally cause the entire table and its indexes to be rewritten." The manual names an exception (a `USING` that does not change the contents and a binary coercible type); the tool cannot judge it, so the finding says "can".

### `set-not-null` (warning)

`ALTER [COLUMN] name SET NOT NULL` on an existing table. Rests on: "Ordinarily this is checked during the ALTER TABLE by scanning the entire table, unless NOT VALID is specified; however, if a valid CHECK constraint exists (and is not dropped in the same command) which proves no NULL can exist, then the table scan is skipped." The fix names the pattern that this sentence and the `NOT VALID` sentences describe: add `CHECK (column IS NOT NULL) NOT VALID`, run `VALIDATE CONSTRAINT`, then `SET NOT NULL`. The tool recognizes that pattern when it is written in exactly that form, in the same set, on the same table and column, and then does not report `SET NOT NULL`. A `CHECK` written in another form is not recognized, and neither is one that was validated outside the files.

### `add-constraint-without-not-valid` (warning)

`ADD [CONSTRAINT name] FOREIGN KEY ...` or `ADD [CONSTRAINT name] CHECK (...)` without `NOT VALID`, on an existing table. `NOT ENFORCED` is not reported either: the manual says that no verification is performed. Rests on: "Scanning a large table to verify new foreign-key, check, or not-null constraints can take a long time, and other updates to the table are locked out until the ALTER TABLE ADD CONSTRAINT command is committed." For a foreign key the message adds that the manual names a `SHARE ROW EXCLUSIVE` lock. `UNIQUE`, `PRIMARY KEY` and `EXCLUDE` constraints are not checked.

### `validate-constraint` (info)

`ALTER TABLE ... VALIDATE CONSTRAINT name`. Rests on: "validation acquires only a SHARE UPDATE EXCLUSIVE lock on the table being altered". It is the good second step of the pattern, so it is info, never a failure.

### `drop-table` (error)

`DROP TABLE [IF EXISTS] a, b [CASCADE]` of an existing table. The tables of the list that are new are left out of the message. Rests on: "DROP TABLE always removes any indexes, rules, triggers, and constraints that exist for the target table." and on the lock list that names `DROP TABLE`. That the data is gone and that running code that still uses the table fails is the tool's own conclusion. Cannot see: whether the data was copied elsewhere first.

### `drop-column` (error)

`ALTER TABLE ... DROP [COLUMN] [IF EXISTS] name`. `DROP CONSTRAINT` is not a column. Rests on: "Whatever data was in the column disappears. Table constraints involving the column are dropped, too."

### `truncate` (error)

`TRUNCATE [TABLE] [ONLY] a, b ...` of an existing table. Rests on: "TRUNCATE quickly removes all rows from a set of tables." and "TRUNCATE acquires an ACCESS EXCLUSIVE lock on each table it operates on, which blocks all other concurrent operations on the table." The fix quotes: "If concurrent access to a table is required, then the DELETE command should be used instead."

### `delete-without-where` and `update-without-where` (error)

`DELETE FROM table` and `UPDATE table SET ...` with no `WHERE` at the top level of the statement. A `WHERE` inside a sub-select does not count. `WHERE CURRENT OF` counts as a `WHERE`. `WITH ... DELETE` and `WITH ... UPDATE` are read: the statement after the list of queries is checked. A data-changing statement inside the parentheses of a `WITH` is not read. Rests on: "If the WHERE clause is absent, the effect is to delete all rows in the table." For `UPDATE` the manual says that only rows for which the condition returns true are updated; that no condition means every row is the tool's own reading. `WHERE true` and `WHERE 1 = 1` count as a `WHERE`. Cannot see: that the table is small or that every row is meant.

### `rename-column` and `rename-table` (warning)

`ALTER TABLE ... RENAME [COLUMN] a TO b` and `ALTER TABLE ... RENAME TO b`. `RENAME CONSTRAINT` is not reported. Rests on the sentence that lists the `RENAME` forms; that running application code still uses the old name is the tool's own conclusion, and the message says "running application code" and not that the manual says it. A rename of a new table is not reported.

### `lock-table-access-exclusive` (warning)

`LOCK [TABLE] name ...` with `IN ACCESS EXCLUSIVE MODE`, or with no mode, which the manual says is `ACCESS EXCLUSIVE`. A weaker mode is not reported. Rests on: "If no lock mode is specified, then ACCESS EXCLUSIVE, the most restrictive mode, is used." and the description of that lock in the chapter on explicit locking.

### `vacuum-full` (warning)

`VACUUM FULL ...`, and `VACUUM (FULL ...)` or `VACUUM (FULL true)`. `VACUUM (FULL false)` and `VACUUM (FULL off)` are not reported. Rests on: "VACUUM FULL rewrites the entire contents of the table into a new disk file with no extra space, allowing unused space to be returned to the operating system. This form is much slower and requires an ACCESS EXCLUSIVE lock on each table while it is being processed." A `VACUUM FULL` with no table name is about every table and is reported.

### `cluster` (warning)

`CLUSTER [VERBOSE] [table [USING index]]`. `ALTER TABLE ... CLUSTER ON` is a different statement and is not reported. Rests on: "When a table is being clustered, an ACCESS EXCLUSIVE lock is acquired on it."

### `missing-terminator` (warning)

The last statement of a file has no closing semicolon. It is reported, and it is checked all the same.

### `unparsed-statement` (warning)

A statement that the tool could not read: it starts with a word that is not the name of a command in the list of SQL commands of the manual, or its parentheses do not match, or a `CREATE INDEX` has no `ON table`. It is reported and not checked, so it is never skipped without a word.

### `unterminated-token` (error)

A string, a quoted name, a block comment or a dollar-quoted body is opened and never closed. Nothing after the opening line is read, and the report says so; the statements before it are checked.

### `limit-reached` (error)

A file has more tokens or statements than the limits allow ([limits.md](limits.md)). The rest of the file was not checked.

### `do-block-not-read` (info)

A `DO` statement. Its body is a string to PostgreSQL, and the tool does not read it, so a statement inside it is not checked.

### `meta-command` (info)

A line that starts with a backslash is a psql command, not SQL. It is listed and not read.

## What a statement is

The tool does not use a regular expression on the text of a file. It reads the text once with a tokenizer that knows comments (a block comment can be nested), strings (also `E'...'` with backslash escapes, `B''`, `X''`, `N''` and `U&''`), quoted names, dollar-quoted bodies and psql lines, and then splits the tokens at semicolons. The semicolons inside a string, a quoted name or a dollar-quoted body do not end a statement, and neither do the semicolons inside the body of a function written with `BEGIN ATOMIC ... END`. The checks read the tokens of one statement, at the level of parentheses where it matters. The text of a string or a comment is not kept, so no value of a row can reach a report.

## Expand and contract

The fixes that say "expand and contract" describe a practice, not a sentence of the manual: first add the new column, table or name beside the old one and move the application to it, and remove the old one in a later migration, when no running version uses it. The manual does not describe it, and the tool does not quote it.

## What the tool does not check

The checks above are the ones the tool has. It does not read `REINDEX`, `ALTER INDEX`, `ADD PRIMARY KEY`, `ADD UNIQUE`, `DROP INDEX`, `DROP SCHEMA`, `DROP DATABASE`, `ALTER TYPE`, `ATTACH PARTITION`, `REFRESH MATERIALIZED VIEW`, triggers, grants or the rest of the language, and it does not read the data-changing statements inside a `WITH` list or a function body. [limits.md](limits.md) lists what a file cannot show.

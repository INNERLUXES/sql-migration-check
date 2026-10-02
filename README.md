# sql-migration-check

Reads PostgreSQL migration files and reports the statements that can lock a table, lose data or break running application code during a deploy. You give it a folder of `.sql` files (or single files). It reads them in order and names, for every risky statement, the file and the line, the kind of statement, the severity, a sentence on how to fix it, and the sentence of the PostgreSQL manual that the finding rests on, with the address of the page.

A migration is applied while the application is running. A plain `CREATE INDEX` makes writes wait until the index is built. A `NOT NULL` column without a default fails when the table has rows. A type change can rewrite the whole table under a lock that blocks even `SELECT`. A rename breaks the version of the application that is still running. A `DROP COLUMN`, a `TRUNCATE`, a `DELETE` or an `UPDATE` with no `WHERE` loses data, and nothing in a build says so. All of these are visible in the file, before the migration reaches a database. This tool reads them in a second, so the check can run on every pull request that adds a migration.

- Every finding has an id, a severity (error, warning or info), the file and the line, the kind of statement, the table, a plain message, a fix and the quoted sentences of the manual with the page address.
- The quotes are quotes. The manual pages are saved in [research/sources](research/sources), and a test compares every quoted sentence, lock name, function name and statement keyword in [src/data.js](src/data.js) with the saved text. Where a finding draws a conclusion that the manual does not state, the message says that it is the tool's own.
- Nothing is skipped without a word. A missing semicolon, a statement the tool could not read, a string or comment that is never closed, a `DO` block and a file cut by a limit are findings, and the report counts the statements that it understood but has no check for.
- A table that an earlier migration of the same set created is a **new table**: nobody uses it yet, so it gets no lock or data findings. For a set that has been applied before, `--since` names the first migration that is still to be applied.
- It reads files only. It never connects to a database, opens no network connection and runs no program. No value of a row, no string and no comment is ever printed.
- A careful tokenizer reads comments (nested too), strings (`E''` too), quoted names and dollar-quoted bodies, so a semicolon inside a string does not split a statement. No pattern runs on the raw text, and the time is linear in the size of the input.
- PostgreSQL only. The checks come from the PostgreSQL manual; the MySQL manual is not among the sources, so MySQL is not read.
- Reports as text, Markdown, JSON and CSV, with an exit code for a pipeline gate. Info findings never fail the run.
- Plain JavaScript, no dependencies; the same files always give the same report.

```
npm test
```

```
ℹ tests 115
ℹ pass 115
ℹ fail 0
ℹ skipped 0
```

## Quick start

Requires Node 22 or newer. There is nothing to install.

```
git clone https://github.com/INNERLUXES/sql-migration-check.git
cd sql-migration-check
node bin/sql-migration-check.js examples/clinic-bookings --since 002_speed_up_lookups.sql
```

Or without a clone, in the folder of your repository:

```
npx --yes github:INNERLUXES/sql-migration-check db/migrations
```

`examples/` holds a made-up clinic bookings database. `examples/clinic-bookings` is a set of five migrations, wrong on purpose. The first creates the tables and has already run everywhere, so the command names `--since 002_speed_up_lookups.sql`: the files before it are read only to learn which tables exist. The others build an index inside a transaction, add a `NOT NULL` column with no default, change a type, add constraints without `NOT VALID`, rename a column, and drop, truncate, delete and update without a `WHERE`. `examples/clinic-bookings-fixed` does the same work the safe way and passes the strictest gate.

## Usage

```
node bin/sql-migration-check.js examples/clinic-bookings --since 002_speed_up_lookups.sql
```

```
sql-migration-check: examples/clinic-bookings/001_create_tables.sql ... examples/clinic-bookings/005_finishing_touches.sql
dialect: PostgreSQL (manual: https://www.postgresql.org/docs/current/)
read: 4 files checked, 22 statements, 1 earlier file read for the table names
findings: 7 error, 11 warning, 2 info

WARNING  index-not-concurrent  examples/clinic-bookings/002_speed_up_lookups.sql:3
         statement: CREATE INDEX, table: appointments
         CREATE INDEX on appointments is not CONCURRENTLY, so writes to appointments wait until the index is built.
         fix: Use CREATE INDEX CONCURRENTLY, in a migration that does not run inside a transaction block.
         manual (CREATE INDEX, Parameters): "When this option is used, PostgreSQL will build the index without taking any locks that prevent concurrent inserts, updates, or deletes on the table; whereas a standard index build locks out writes (but not reads) on the table until it's done."
           https://www.postgresql.org/docs/current/sql-createindex.html

ERROR    concurrently-in-transaction  examples/clinic-bookings/002_speed_up_lookups.sql:4
         statement: CREATE INDEX CONCURRENTLY, table: appointments
         CREATE INDEX CONCURRENTLY on appointments is written inside a transaction block (BEGIN at line 2). The manual says it cannot run in one, so the statement fails.
         fix: Move the statement out of the BEGIN ... COMMIT block, into a migration of its own that your tool does not wrap in a transaction.
         manual (CREATE INDEX, Building Indexes Concurrently): "Another difference is that a regular CREATE INDEX command can be performed within a transaction block, but CREATE INDEX CONCURRENTLY cannot."
           https://www.postgresql.org/docs/current/sql-createindex.html
         manual (BEGIN, Description): "BEGIN initiates a transaction block, that is, all statements after a BEGIN command will be executed in a single transaction until an explicit COMMIT or ROLLBACK is given."
           https://www.postgresql.org/docs/current/sql-begin.html

ERROR    add-column-not-null-no-default  examples/clinic-bookings/003_patient_details.sql:2
         statement: ALTER TABLE ADD COLUMN, table: patients
         ADD COLUMN phone is NOT NULL and has no DEFAULT. The manual says a column without a default is filled with NULL and that a NOT NULL column cannot hold null values, so the statement fails when patients already has rows (this conclusion is the tool's own).
         fix: Add the column with a constant DEFAULT, or without NOT NULL, fill the existing rows in batches, and add NOT NULL in a later migration.
         manual (ALTER TABLE, Notes): "If no column constraints are specified, NULL is used as the DEFAULT."
           https://www.postgresql.org/docs/current/sql-altertable.html
         manual (CREATE TABLE, Parameters): "The column is not allowed to contain null values."
           https://www.postgresql.org/docs/current/sql-createtable.html

WARNING  add-column-volatile-default  examples/clinic-bookings/003_patient_details.sql:3
         statement: ALTER TABLE ADD COLUMN, table: patients
         The DEFAULT of ADD COLUMN created_at calls clock_timestamp(), which the manual names as volatile. A volatile DEFAULT rewrites the entire table and its indexes.
         fix: Add the column without a default (or with a constant one), fill the existing rows in batches, then set the default for new rows with ALTER COLUMN ... SET DEFAULT.
         manual (ALTER TABLE, Notes): "Adding a column with a volatile DEFAULT (e.g., clock_timestamp()), a stored generated column, an identity column, or a column with a domain data type that has constraints will cause the entire table and its indexes to be rewritten."
           https://www.postgresql.org/docs/current/sql-altertable.html
         manual (36.7. Function Volatility Categories): "Even a function with no side-effects needs to be labeled VOLATILE if its value can change within a single query; some examples are random(), currval(), timeofday()."
           https://www.postgresql.org/docs/current/xfunc-volatility.html
         manual (ALTER TABLE, Description): "The new default value will only apply in subsequent INSERT or UPDATE commands; it does not cause rows already in the table to change."
           https://www.postgresql.org/docs/current/sql-altertable.html

WARNING  alter-column-type  examples/clinic-bookings/003_patient_details.sql:4
         statement: ALTER TABLE ALTER COLUMN TYPE, table: patients
         ALTER COLUMN date_of_birth TYPE can rewrite patients and its indexes. The manual says it will normally do so, except when the USING clause does not change the contents and the old type is binary coercible to the new one, which the tool cannot judge.
         fix: Add a column of the new type, copy the values in batches, move the application to it and drop the old column in a later migration; or confirm that this change needs no rewrite.
         manual (ALTER TABLE, Notes): "Changing the type of an existing column will normally cause the entire table and its indexes to be rewritten."
           https://www.postgresql.org/docs/current/sql-altertable.html
         manual (ALTER TABLE, Description): "An ACCESS EXCLUSIVE lock is acquired unless explicitly noted."
           https://www.postgresql.org/docs/current/sql-altertable.html
         manual (ALTER TABLE, Notes): "Table and/or index rebuilds may take a significant amount of time for a large table, and will temporarily require as much as double the disk space."
           https://www.postgresql.org/docs/current/sql-altertable.html

WARNING  set-not-null  examples/clinic-bookings/003_patient_details.sql:5
         statement: ALTER TABLE ALTER COLUMN SET NOT NULL, table: patients
         SET NOT NULL on email scans all of patients to check that no row holds NULL, while the ALTER TABLE lock is held.
         fix: Add CHECK (email IS NOT NULL) NOT VALID, run VALIDATE CONSTRAINT on it, then SET NOT NULL: the manual says the scan is skipped when a valid CHECK constraint proves that no NULL can exist.
         manual (ALTER TABLE, Description): "Ordinarily this is checked during the ALTER TABLE by scanning the entire table, unless NOT VALID is specified; however, if a valid CHECK constraint exists (and is not dropped in the same command) which proves no NULL can exist, then the table scan is skipped."
           https://www.postgresql.org/docs/current/sql-altertable.html
         manual (ALTER TABLE, Description): "An ACCESS EXCLUSIVE lock is acquired unless explicitly noted."
           https://www.postgresql.org/docs/current/sql-altertable.html
         manual (ALTER TABLE, Notes): "With NOT VALID, the ADD CONSTRAINT command does not scan the table and can be committed immediately. After that, a VALIDATE CONSTRAINT command can be issued to verify that existing rows satisfy the constraint."
           https://www.postgresql.org/docs/current/sql-altertable.html

WARNING  add-constraint-without-not-valid  examples/clinic-bookings/003_patient_details.sql:7
         statement: ALTER TABLE ADD CONSTRAINT, table: appointments
         ADD FOREIGN KEY constraint without NOT VALID scans all of appointments to check the existing rows, and updates to the table are locked out until the statement is committed. A foreign key also takes a lock on the referenced table.
         fix: Add the constraint with NOT VALID, then run ALTER TABLE ... VALIDATE CONSTRAINT in a separate statement.
         manual (ALTER TABLE, Notes): "Scanning a large table to verify new foreign-key, check, or not-null constraints can take a long time, and other updates to the table are locked out until the ALTER TABLE ADD CONSTRAINT command is committed."
           https://www.postgresql.org/docs/current/sql-altertable.html
         manual (ALTER TABLE, Notes): "With NOT VALID, the ADD CONSTRAINT command does not scan the table and can be committed immediately. After that, a VALIDATE CONSTRAINT command can be issued to verify that existing rows satisfy the constraint."
           https://www.postgresql.org/docs/current/sql-altertable.html
         manual (ALTER TABLE, Description): "Although most forms of ADD table_constraint require an ACCESS EXCLUSIVE lock, ADD FOREIGN KEY requires only a SHARE ROW EXCLUSIVE lock."
           https://www.postgresql.org/docs/current/sql-altertable.html

WARNING  add-constraint-without-not-valid  examples/clinic-bookings/003_patient_details.sql:9
         statement: ALTER TABLE ADD CONSTRAINT, table: appointments
         ADD CHECK constraint without NOT VALID scans all of appointments to check the existing rows, and updates to the table are locked out until the statement is committed.
         fix: Add the constraint with NOT VALID, then run ALTER TABLE ... VALIDATE CONSTRAINT in a separate statement.
         manual (ALTER TABLE, Notes): "Scanning a large table to verify new foreign-key, check, or not-null constraints can take a long time, and other updates to the table are locked out until the ALTER TABLE ADD CONSTRAINT command is committed."
           https://www.postgresql.org/docs/current/sql-altertable.html
         manual (ALTER TABLE, Notes): "With NOT VALID, the ADD CONSTRAINT command does not scan the table and can be committed immediately. After that, a VALIDATE CONSTRAINT command can be issued to verify that existing rows satisfy the constraint."
           https://www.postgresql.org/docs/current/sql-altertable.html

WARNING  rename-column  examples/clinic-bookings/004_cleanup.sql:2
         statement: ALTER TABLE RENAME COLUMN, table: appointments
         RENAME COLUMN starts_at TO start_time on appointments. Running application code, and the version of it that is still deployed, uses the old name and fails.
         fix: Expand and contract: add the new column, write to both, backfill, move the application to the new name, and drop the old column in a later migration; or rename only when no old version of the application is running.
         manual (ALTER TABLE, Description): "The RENAME forms change the name of a table (or an index, sequence, view, materialized view, or foreign table), the name of an individual column in a table, or the name of a constraint of the table."
           https://www.postgresql.org/docs/current/sql-altertable.html

ERROR    drop-column  examples/clinic-bookings/004_cleanup.sql:3
         statement: ALTER TABLE DROP COLUMN, table: appointments
         DROP COLUMN notes on appointments deletes the data of the column, and running application code that still reads or writes it fails.
         fix: Expand and contract: stop all reads and writes of the column in the application first, keep the column for one release, copy what you need elsewhere, and drop it in a later migration.
         manual (5.7. Modifying Tables, 5.7.2. Removing a Column): "Whatever data was in the column disappears. Table constraints involving the column are dropped, too."
           https://www.postgresql.org/docs/current/ddl-alter.html

ERROR    drop-table  examples/clinic-bookings/004_cleanup.sql:4
         statement: DROP TABLE, table: legacy_waitlist
         DROP TABLE removes legacy_waitlist with its indexes, rules, triggers and constraints, and all of its data. Running application code that still reads or writes it fails.
         fix: Expand and contract: stop all reads and writes in the application first, keep the table for one release (or rename it out of the way), copy what you need elsewhere, and drop it in a later migration.
         manual (DROP TABLE, Description): "DROP TABLE always removes any indexes, rules, triggers, and constraints that exist for the target table."
           https://www.postgresql.org/docs/current/sql-droptable.html
         manual (13.3. Explicit Locking, 13.3.1. Table-Level Locks): "Acquired by the DROP TABLE, TRUNCATE, REINDEX, CLUSTER, VACUUM FULL, and REFRESH MATERIALIZED VIEW (without CONCURRENTLY) commands."
           https://www.postgresql.org/docs/current/explicit-locking.html

ERROR    truncate  examples/clinic-bookings/004_cleanup.sql:5
         statement: TRUNCATE, table: reminders
         TRUNCATE removes all rows of reminders and takes an ACCESS EXCLUSIVE lock on each table, which blocks all other concurrent operations on it.
         fix: Make sure that the data is meant to go. On a table that is in use, delete the rows in batches with a WHERE clause instead.
         manual (TRUNCATE, Description): "TRUNCATE quickly removes all rows from a set of tables."
           https://www.postgresql.org/docs/current/sql-truncate.html
         manual (TRUNCATE, Notes): "TRUNCATE acquires an ACCESS EXCLUSIVE lock on each table it operates on, which blocks all other concurrent operations on the table."
           https://www.postgresql.org/docs/current/sql-truncate.html
         manual (TRUNCATE, Notes): "If concurrent access to a table is required, then the DELETE command should be used instead."
           https://www.postgresql.org/docs/current/sql-truncate.html

ERROR    delete-without-where  examples/clinic-bookings/004_cleanup.sql:6
         statement: DELETE, table: appointments
         DELETE FROM appointments has no WHERE clause, so it deletes every row of the table.
         fix: Add a WHERE clause. If every row is meant to go, say so in a comment, and on a large table delete in batches.
         manual (DELETE, Description): "If the WHERE clause is absent, the effect is to delete all rows in the table."
           https://www.postgresql.org/docs/current/sql-delete.html

ERROR    update-without-where  examples/clinic-bookings/004_cleanup.sql:7
         statement: UPDATE, table: patients
         UPDATE patients has no WHERE clause, so it changes every row of the table.
         fix: Add a WHERE clause. If every row is meant to change, say so in a comment, and on a large table update in batches.
         manual (UPDATE, Parameters): "Only rows for which this expression returns true will be updated."
           https://www.postgresql.org/docs/current/sql-update.html

WARNING  lock-table-access-exclusive  examples/clinic-bookings/004_cleanup.sql:8
         statement: LOCK TABLE, table: rooms
         LOCK TABLE rooms takes the ACCESS EXCLUSIVE lock, which conflicts with locks of all modes and blocks even a plain SELECT, until the transaction ends.
         fix: Take the weakest lock mode that does the job, or remove the statement when the command that follows takes the lock it needs by itself.
         manual (13.3. Explicit Locking, 13.3.1. Table-Level Locks): "Conflicts with locks of all modes (ACCESS SHARE, ROW SHARE, ROW EXCLUSIVE, SHARE UPDATE EXCLUSIVE, SHARE, SHARE ROW EXCLUSIVE, EXCLUSIVE, and ACCESS EXCLUSIVE). This mode guarantees that the holder is the only transaction accessing the table in any way."
           https://www.postgresql.org/docs/current/explicit-locking.html
         manual (13.3. Explicit Locking, 13.3.1. Table-Level Locks): "Only an ACCESS EXCLUSIVE lock blocks a SELECT (without FOR UPDATE/SHARE) statement."
           https://www.postgresql.org/docs/current/explicit-locking.html

WARNING  vacuum-full  examples/clinic-bookings/004_cleanup.sql:9
         statement: VACUUM FULL, table: appointments
         VACUUM FULL rewrites appointments into a new file and holds an ACCESS EXCLUSIVE lock on each table while it does.
         fix: Use a plain VACUUM, which does not take that lock, or run VACUUM FULL in a maintenance window when no application is using the table.
         manual (VACUUM, Description): "VACUUM FULL rewrites the entire contents of the table into a new disk file with no extra space, allowing unused space to be returned to the operating system. This form is much slower and requires an ACCESS EXCLUSIVE lock on each table while it is being processed."
           https://www.postgresql.org/docs/current/sql-vacuum.html

WARNING  cluster  examples/clinic-bookings/004_cleanup.sql:10
         statement: CLUSTER, table: appointments
         CLUSTER rewrites appointments and holds an ACCESS EXCLUSIVE lock on it, so no other session can read or write the table until it is finished.
         fix: Run CLUSTER in a maintenance window when no application is using the table.
         manual (CLUSTER, Description): "When a table is being clustered, an ACCESS EXCLUSIVE lock is acquired on it. This prevents any other database operations (both reads and writes) from operating on the table until the CLUSTER is finished."
           https://www.postgresql.org/docs/current/sql-cluster.html

INFO     validate-constraint  examples/clinic-bookings/005_finishing_touches.sql:2
         statement: ALTER TABLE VALIDATE CONSTRAINT, table: appointments
         VALIDATE CONSTRAINT appointments_patient_fk checks the existing rows of appointments. It takes only a SHARE UPDATE EXCLUSIVE lock, so writes continue; it is the second step of the NOT VALID pattern.
         fix: No change is needed. Run it in a migration of its own, so that the scan does not hold up other changes.
         manual (ALTER TABLE, Notes): "The validation step does not need to lock out concurrent updates, since it knows that other transactions will be enforcing the constraint for rows that they insert or update; only pre-existing rows need to be checked. Hence, validation acquires only a SHARE UPDATE EXCLUSIVE lock on the table being altered."
           https://www.postgresql.org/docs/current/sql-altertable.html

INFO     do-block-not-read  examples/clinic-bookings/005_finishing_touches.sql:4
         statement: DO
         The body of a DO block is not read, so a statement inside it is not checked.
         fix: Write the statements in the migration file itself, outside the DO block, so that they are checked.

WARNING  missing-terminator  examples/clinic-bookings/005_finishing_touches.sql:10
         statement: INSERT
         The last statement of the file is not ended with a semicolon.
         fix: End the statement with a semicolon, so that where it ends is not left to the tool that runs the file.

note: 1 file before examples/clinic-bookings/002_speed_up_lookups.sql was read only to learn which tables already exist; nothing in it is reported
note: 3 statements were understood but have no check (for example SELECT, INSERT and CREATE TABLE)

GATE: FAIL - 7 errors
```

The exit code is `1`: an index built inside a transaction, a `NOT NULL` column that cannot be added, and the statements that lose data are errors, and errors fail the run by default. The eleven warnings do not, unless you run with `--fail-on warning`. The statements in `004_cleanup.sql` show the whole list: a rename, a dropped column, a dropped table, a truncate, a delete and an update with no `WHERE`, an `ACCESS EXCLUSIVE` lock, `VACUUM FULL` and `CLUSTER`. The values in the `INSERT` of the first migration are not in the report, and neither is any string of the files.

The fixed migrations pass, also with `--fail-on warning`:

```
node bin/sql-migration-check.js examples/clinic-bookings-fixed --since 002_speed_up_lookups.sql --fail-on warning
```

```
sql-migration-check: examples/clinic-bookings-fixed/001_create_tables.sql ... examples/clinic-bookings-fixed/004_validate_and_tidy.sql
dialect: PostgreSQL (manual: https://www.postgresql.org/docs/current/)
read: 3 files checked, 18 statements, 1 earlier file read for the table names
findings: 0 error, 0 warning, 3 info

INFO     validate-constraint  examples/clinic-bookings-fixed/004_validate_and_tidy.sql:2
         statement: ALTER TABLE VALIDATE CONSTRAINT, table: patients
         VALIDATE CONSTRAINT patients_email_present checks the existing rows of patients. It takes only a SHARE UPDATE EXCLUSIVE lock, so writes continue; it is the second step of the NOT VALID pattern.
         fix: No change is needed. Run it in a migration of its own, so that the scan does not hold up other changes.
         manual (ALTER TABLE, Notes): "The validation step does not need to lock out concurrent updates, since it knows that other transactions will be enforcing the constraint for rows that they insert or update; only pre-existing rows need to be checked. Hence, validation acquires only a SHARE UPDATE EXCLUSIVE lock on the table being altered."
           https://www.postgresql.org/docs/current/sql-altertable.html

INFO     validate-constraint  examples/clinic-bookings-fixed/004_validate_and_tidy.sql:3
         statement: ALTER TABLE VALIDATE CONSTRAINT, table: appointments
         VALIDATE CONSTRAINT appointments_patient_fk checks the existing rows of appointments. It takes only a SHARE UPDATE EXCLUSIVE lock, so writes continue; it is the second step of the NOT VALID pattern.
         fix: No change is needed. Run it in a migration of its own, so that the scan does not hold up other changes.
         manual (ALTER TABLE, Notes): "The validation step does not need to lock out concurrent updates, since it knows that other transactions will be enforcing the constraint for rows that they insert or update; only pre-existing rows need to be checked. Hence, validation acquires only a SHARE UPDATE EXCLUSIVE lock on the table being altered."
           https://www.postgresql.org/docs/current/sql-altertable.html

INFO     validate-constraint  examples/clinic-bookings-fixed/004_validate_and_tidy.sql:4
         statement: ALTER TABLE VALIDATE CONSTRAINT, table: appointments
         VALIDATE CONSTRAINT appointments_start_check checks the existing rows of appointments. It takes only a SHARE UPDATE EXCLUSIVE lock, so writes continue; it is the second step of the NOT VALID pattern.
         fix: No change is needed. Run it in a migration of its own, so that the scan does not hold up other changes.
         manual (ALTER TABLE, Notes): "The validation step does not need to lock out concurrent updates, since it knows that other transactions will be enforcing the constraint for rows that they insert or update; only pre-existing rows need to be checked. Hence, validation acquires only a SHARE UPDATE EXCLUSIVE lock on the table being altered."
           https://www.postgresql.org/docs/current/sql-altertable.html

note: 1 file before examples/clinic-bookings-fixed/002_speed_up_lookups.sql was read only to learn which tables already exist; nothing in it is reported
note: 1 statement was understood but has no check (for example SELECT, INSERT and CREATE TABLE)

GATE: PASS (--fail-on warning)
```

The three info findings are the `VALIDATE CONSTRAINT` statements, the second step of the `NOT VALID` pattern. After them, `SET NOT NULL` is not reported, because the manual says the scan is skipped when a valid `CHECK` constraint proves that no `NULL` can exist, and the tool saw that constraint added and validated.

Passing means that none of the checks found anything in the files. It does not mean that the migration is safe on your database; [docs/limits.md](docs/limits.md) lists what a file cannot show.

```
sql-migration-check <file-or-folder>... [options]
```

```
--format <name>     text, markdown, json or csv (default: text)
--fail-on <level>   exit with 1 when a finding is at this level or above: error or warning
                    (default: error); info never fails the run
--since <file>      the first migration that is still to be applied; the files before it are read only
                    to learn which tables exist, and nothing in them is reported
--help              show the usage
--version           show the version
```

A folder gives its `.sql` files in name order (compared by code unit, so write numbers with leading zeros); files named one by one are read in the order given. Paths in the report are relative to the folder you run the command in, with forward slashes on every system; a file outside it is shown with its absolute path.

## The checks

| Id | Severity | What it reports |
| --- | --- | --- |
| `index-not-concurrent` | warning | `CREATE INDEX` without `CONCURRENTLY` on an existing table |
| `concurrently-in-transaction` | error | `CREATE INDEX CONCURRENTLY` between `BEGIN` and `COMMIT` in the same file |
| `add-column-not-null-no-default` | error | `ADD COLUMN ... NOT NULL` with no `DEFAULT` on an existing table |
| `add-column-volatile-default` | warning | `ADD COLUMN` with a default that calls `clock_timestamp`, `random`, `currval` or `timeofday` |
| `add-column-rewrite` | warning | `ADD COLUMN` of an identity column or a stored generated column |
| `default-function-unclassified` | info | a default that calls a function the tool cannot classify, or a serial type |
| `alter-column-type` | warning | `ALTER COLUMN ... TYPE` |
| `set-not-null` | warning | `ALTER COLUMN ... SET NOT NULL`, unless a validated `CHECK (column IS NOT NULL)` came before |
| `add-constraint-without-not-valid` | warning | `ADD FOREIGN KEY` or `ADD CHECK` without `NOT VALID` |
| `validate-constraint` | info | `VALIDATE CONSTRAINT` |
| `drop-table` | error | `DROP TABLE` of an existing table |
| `drop-column` | error | `DROP COLUMN` |
| `truncate` | error | `TRUNCATE` of an existing table |
| `delete-without-where` | error | `DELETE` with no `WHERE` |
| `update-without-where` | error | `UPDATE` with no `WHERE` |
| `rename-column` | warning | `RENAME COLUMN` |
| `rename-table` | warning | `RENAME TO` on a table |
| `lock-table-access-exclusive` | warning | `LOCK TABLE` in `ACCESS EXCLUSIVE` mode, or with no mode |
| `vacuum-full` | warning | `VACUUM FULL` |
| `cluster` | warning | `CLUSTER` |
| `missing-terminator` | warning | the last statement of a file has no semicolon |
| `unparsed-statement` | warning | a statement the tool could not read |
| `unterminated-token` | error | a string, name, comment or dollar-quoted body that is never closed |
| `limit-reached` | error | a file is over the token or statement limit, so the rest was not checked |
| `do-block-not-read` | info | a `DO` block, whose body is not read |
| `meta-command` | info | a psql backslash line, which is not SQL |

[docs/method.md](docs/method.md) gives each check, its exact rule, what it can see and what it cannot. [docs/rules-and-sources.md](docs/rules-and-sources.md) lists every quoted sentence with the saved page it comes from.

## New tables and `--since`

A table that a statement of the set created with `CREATE TABLE`, before the statement that uses it, is new: it holds no rows and nobody else uses it, so a lock on it blocks nothing and a `NOT NULL` column without a default cannot fail. The checks that are about a table in use skip it. This is the tool's own rule, described in [docs/method.md](docs/method.md). It holds when the set is applied from an empty database. When the earlier migrations have already run, give `--since <first-pending-file>`: the earlier files are read only to learn which tables exist, those tables are existing, and nothing in the earlier files is reported.

## Where the facts come from

| Fact | Source |
| --- | --- |
| A standard index build locks out writes; `CONCURRENTLY` cannot run in a transaction block | https://www.postgresql.org/docs/current/sql-createindex.html |
| `ADD COLUMN` defaults, rewrites, type changes, `SET NOT NULL`, `NOT VALID`, `VALIDATE CONSTRAINT`, `RENAME`, lock levels | https://www.postgresql.org/docs/current/sql-altertable.html |
| A `NOT NULL` column cannot hold null values | https://www.postgresql.org/docs/current/sql-createtable.html |
| The lock modes, and which commands take `ACCESS EXCLUSIVE` | https://www.postgresql.org/docs/current/explicit-locking.html |
| `DROP TABLE`, `TRUNCATE`, `DELETE`, `UPDATE`, `LOCK`, `VACUUM FULL`, `CLUSTER` | the pages of those commands, listed in [docs/rules-and-sources.md](docs/rules-and-sources.md) |
| Which functions are volatile | https://www.postgresql.org/docs/current/xfunc-volatility.html and the `ALTER TABLE` page |
| Transaction blocks: `BEGIN`, `START TRANSACTION`, `COMMIT`, `END`, `ROLLBACK`, `ABORT`, `ROLLBACK TO SAVEPOINT` | the pages of those commands |

## Formats

- `text`: for a terminal: the files read, the counts, then each finding with its file and line, statement, message, fix and the quoted manual sentences with their addresses.
- `markdown`: the same as a table for a pull request comment or the job summary. Pipes, line breaks and angle brackets from the input are escaped, so a name from a file cannot break the table.
- `json`: the whole report: the files, the counts, every finding with id, severity, file, line, statement, table, message, fix and manual sentences, the notes and the gate.
- `csv`: one row per finding, quoted as RFC 4180 says. A cell that starts with `=`, `+`, `-` or `@` gets a leading `'`, so a spreadsheet does not run it as a formula.

To put the report in the job summary of a GitHub Actions run:

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
    with:
      node-version: 22
  - name: Migration report
    run: npx --yes github:INNERLUXES/sql-migration-check db/migrations --format markdown >> "$GITHUB_STEP_SUMMARY"
  - name: Migration gate
    run: npx --yes github:INNERLUXES/sql-migration-check db/migrations --fail-on warning
```

It needs no database, no secrets and no build; a Linux runner is enough. Start with the default gate (errors only), and move to `--fail-on warning` when the first report is clean. On a pull request, pass `--since` with the first migration that the pull request adds.

## Exit codes

`0` no finding at the `--fail-on` level, `1` at least one such finding (by default: an error), `2` a usage or input error (a missing path, a folder with no `.sql` file, a file over the size limit, a `--since` that matches no file, an unknown option).

A statement that cannot be read is not exit code `2`: it is a finding (`unparsed-statement`), so the run still checks everything else.

## Limits

The tool reads what the files say, not what the database does. It does not know the size of a table, the traffic, the version of PostgreSQL or the version of the application that is running. A finding says what a statement can do. A pass is not a safe migration. The files are plain PostgreSQL `.sql`; the formats of migration frameworks are not read, and MySQL is not read. [docs/limits.md](docs/limits.md) lists the rest, and [docs/threat-model.md](docs/threat-model.md) and [docs/secure-defaults.md](docs/secure-defaults.md) say how the tool treats a hostile file.

## Related

The tool covers the safety of the migrations. It does not repeat its neighbour in the same organization: `tenancy-check` reads the SQL schema of a multi-tenant product for tenant columns, unique rules, foreign keys and row level security. Where this tool and that one both read a `CREATE TABLE`, the questions differ: this one asks what a statement does to a running system, that one asks whose rows a table holds.

## Background

- How databases are designed, migrated, tuned and kept available, with checks like this one in the pipeline: [database development services](https://innerluxes.dev/software-development/databases).

## License

MIT

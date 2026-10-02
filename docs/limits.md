# Limits

## What the tool can know

- **It sees text, not the database.** The tool does not know how big a table is, how much traffic it has, whether a table has rows, which version of PostgreSQL runs, what the settings are, or which version of the application is deployed. A finding says what the statement can do. A small table makes a plain `CREATE INDEX` harmless, and an empty table makes `ADD COLUMN ... NOT NULL` succeed; the tool reports both, because it cannot see the table.
- **A finding is a review item, not proof.** `drop-table` and `rename-column` rest partly on a conclusion about running application code that no file can show. A migration that is applied while no application runs, or that follows the expand and contract pattern across releases, is safe in a way the tool cannot see.
- **A pass is not a safe migration.** Passing means that none of the checks found anything in the files. The checks are the ones listed in [method.md](method.md), which also lists statements that are not read.
- **New tables are an assumption.** A table that the set creates is new for the statements after it. That holds when the set is applied from the start. For a set that has partly been applied, use `--since`. The tool cannot see a table that was created by hand, by another tool, or by a statement inside a `DO` block, so it treats such a table as existing.
- **Names are compared as PostgreSQL compares them, with one assumption.** `public.t` is the same as `t`, which holds when `public` is on the search path. A table in another schema is a different table. A `search_path` set in the file is not followed.
- **Transactions are read from the file.** A runner that wraps each file, or the whole set, in a transaction is not seen. Whether `CREATE INDEX CONCURRENTLY` also fails when the runner sends several statements in one message is not decided here.
- **Volatility is known for four functions.** `clock_timestamp`, `random`, `currval` and `timeofday` are named as volatile in the manual. Any other function in a default is reported as unclassified, an info that never fails the run.
- **A `CHECK` that proves `NOT NULL` is recognized in one form only**: `CHECK (column IS NOT NULL) NOT VALID`, validated with `VALIDATE CONSTRAINT` in the same set, before `SET NOT NULL` on the same table and column.
- **One dialect.** PostgreSQL, as the saved pages describe it. MySQL is not read: its manual is not among the sources.
- **Plain SQL files only**, as [inputs.md](inputs.md) says.

## What the tool does not check

- Whether a migration is correct, or whether it does what its author meant.
- Statements that this tool has no check for: `REINDEX`, `ALTER INDEX`, `ADD PRIMARY KEY`, `ADD UNIQUE`, `DROP INDEX`, `DROP SCHEMA`, `DROP DATABASE`, `ALTER TYPE`, partition changes, `REFRESH MATERIALIZED VIEW`, triggers, roles and grants.
- Tenant columns, row level security and the other multi-tenant questions of a schema. The neighbour tool `tenancy-check` reads a schema for those; this tool reads the safety of the migrations that change it.
- Data migrations that are written in a language other than SQL.

## Size and depth

- A file over 5 MB is refused, from the size of the open file. All files over 50 MB together are refused. More than 5,000 files are refused.
- A file with more than 2,000,000 tokens or 200,000 statements is cut there, and `limit-reached` says that the rest was not checked.
- Only the first 20 psql lines of each file are listed.
- The tokenizer reads every character once. A string, a name, a comment or a dollar-quoted body that is never closed stops the read of that file at its opening line (`unterminated-token`).

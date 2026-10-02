# 1. Read the files, not the database

## Context

The tool needs to say which statements of a set of migrations can lock a table, lose data or break running code during a deploy. There are richer ways to know: connect to the database and look at the size of each table and the locks that are held, run the migration on a copy, or ask the planner what a statement will do. All of them need a database, an account, and a copy that is as large as the real data, and a copy of production data in a pipeline is itself a risk.

A file does not say everything. A table may be tiny, a statement may run in a window with no traffic, and a rename may be paired with a view that keeps the old name alive. The tool cannot see any of that.

## Decision

The tool reads migration files as text, with its own tokenizer, and never connects to a database. It takes every rule and every quoted sentence from pages of the PostgreSQL manual that are saved with their addresses, and a test compares the code with the saved text. Where a finding rests on a conclusion that the manual does not state (a `NOT NULL` column without a default fails when rows exist, a dropped table breaks code that uses it), the message says that the conclusion is the tool's own.

A table that the same set of migrations created before the statement is a new table and is skipped by the checks that are about a table in use. For a set that has been applied before, `--since` names the first migration that is still to be applied, so earlier tables count as existing. The rule is simple enough to state in one line, and it is the same on every run.

A thing the tool cannot read is reported, never skipped: a statement it could not parse, a string that is never closed, a `DO` block, a psql line, a file cut by a limit.

## Consequences

The check runs in a second, on Linux, macOS or Windows, with only Node, no account and no network access, and no input can make it run code or reach a host. The same files give the same report, so it can run on every pull request and gate a release. The price is that it reports what a statement can do, not what it will do on this database. A small table gets the same warning as a large one, and the person who reads the report decides. The findings that depend on running code say so in their wording.

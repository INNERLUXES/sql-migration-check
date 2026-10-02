# Changes

## 1.0.0

First release.

- Reads PostgreSQL migration files (plain `.sql`: files in the order given, or the `.sql` files of a folder in name order) and reports the statements that can lock a table, lose data or break running application code during a deploy. Never connects to a database and never fetches anything.
- Locks and rewrites: `CREATE INDEX` without `CONCURRENTLY` on an existing table, `CREATE INDEX CONCURRENTLY` inside `BEGIN` ... `COMMIT`, a volatile `DEFAULT` or an identity or stored generated column in `ADD COLUMN`, `ALTER COLUMN ... TYPE`, `SET NOT NULL`, `ADD FOREIGN KEY` and `ADD CHECK` without `NOT VALID`, `LOCK TABLE` at `ACCESS EXCLUSIVE`, `VACUUM FULL`, `CLUSTER` (`index-not-concurrent`, `concurrently-in-transaction`, `add-column-volatile-default`, `add-column-rewrite`, `alter-column-type`, `set-not-null`, `add-constraint-without-not-valid`, `lock-table-access-exclusive`, `vacuum-full`, `cluster`).
- Failing statements and data loss: `ADD COLUMN ... NOT NULL` without a default, `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE` and `UPDATE` without `WHERE` (`add-column-not-null-no-default`, `drop-table`, `drop-column`, `truncate`, `delete-without-where`, `update-without-where`).
- Running code: `RENAME COLUMN` and `RENAME TO` (`rename-column`, `rename-table`).
- Info that never fails the run: `VALIDATE CONSTRAINT`, a default that calls a function the tool cannot classify, a `DO` block, a psql line (`validate-constraint`, `default-function-unclassified`, `do-block-not-read`, `meta-command`).
- Nothing is skipped silently: a missing semicolon, a statement that cannot be read, a string or comment that is never closed, and a file cut by a limit are findings (`missing-terminator`, `unparsed-statement`, `unterminated-token`, `limit-reached`).
- Tables that the same set created earlier are new tables and get no lock or data findings; `--since` names the first migration that is still to be applied, so earlier tables count as existing.
- The documented pattern is recognized: `CHECK (column IS NOT NULL) NOT VALID`, then `VALIDATE CONSTRAINT`, then `SET NOT NULL` is not reported.
- Every finding has an id, a severity (error, warning, info), the file and line, the kind of statement, the table, a message, a fix and the sentences of the PostgreSQL manual it rests on, with the address of the page. No value of a row, no string and no comment of a file is printed.
- The manual pages are saved in `research/sources`; a test compares every quoted sentence, lock name, function name and statement keyword with the saved text.
- A tokenizer for comments (nested too), strings, quoted names, dollar-quoted bodies and psql lines; no pattern runs on the raw text, and the time is linear in the size of the input.
- Reports as text, Markdown, JSON and CSV; `--fail-on` for a pipeline gate; info never fails the run; exit code `2` for a usage or input error.
- Safe input: files over 5 MB are refused, the number and total size of files are bounded, token and statement counts are bounded, and control characters are removed from every text shown.
- Release packages come with a CycloneDX SBOM, SHA-256 checksums and a build provenance attestation.

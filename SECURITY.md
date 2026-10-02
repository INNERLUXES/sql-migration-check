# Security

## Reporting a problem

Write to info@innerluxes.dev with the subject line "sql-migration-check security", or use private vulnerability reporting on this repository. Please do not open a public issue for a vulnerability.

Include a small made-up migration file that shows the problem, what you expected and what happened. Use made-up table names, and no real data, credentials, internal addresses or customer information.

## Scope

In scope:

- an input that makes the tool open a network connection, connect to a database, open a file other than the ones it was given, or run a program
- an input that makes the tool print a value that is documented not to be printed: the text of a string, a comment, a dollar-quoted body or a value of a statement
- an input that makes the tool hang, take very long, or use unbounded memory, such as a very long string, a long run of quotes or comment openers, very many statements, very many files, or a path that is not a regular file
- text from a file name, a table name or a column name that breaks a Markdown table, injects a formula into a CSV report, or rewrites the terminal through control or direction characters
- a finding that docs/method.md says is reported, for an input the tool accepts, that the report leaves out, or a statement that docs/method.md says is reported as not read that the report counts as checked

Out of scope: whether a migration is safe on your database (docs/limits.md lists what a file cannot show), the PostgreSQL manual and the behavior of PostgreSQL itself, and how your pipeline stores the reports.

Read [docs/threat-model.md](docs/threat-model.md) for the rest.

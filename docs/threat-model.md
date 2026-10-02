# Threat model

## What the tool touches

- It reads the files named on the command line and the `.sql` files directly inside the folders named on the command line. Nothing else on the disk is opened.
- It does not follow a path or an address written inside a file. A symbolic link given as an argument, or found in a folder, is followed to a regular file, because the person who runs the tool put it there; the target must be a regular file.
- It writes only to the screen (standard output and standard error).
- It opens no network connection and runs no program: not a shell, not `git`, not `psql`, not a database.

## What the input may hold

Migration files are often checked in a pipeline that runs on pull requests, including pull requests from people outside the team. The tool treats every file as possibly hostile. It can be huge, hold millions of quotes or comment openers, never close a string, hold a name that is made of control characters, or hold SQL that would do harm if it ran. The tool never runs it.

## What could go wrong, and what stops it

| Risk | Control |
| --- | --- |
| A huge file, a huge number of files, or very many tokens or statements exhaust memory or time | A file over 5 MB is refused from the size of the open file before it is read, the files together over 50 MB and more than 5,000 files are refused, and a file with more than 2,000,000 tokens or 200,000 statements is cut with `limit-reached` |
| A crafted run of quotes, comment openers, dollar tags or parentheses makes a pattern run for a very long time | The tokenizer reads each character once and uses no regular expression on the raw text. A dollar-quoted body is closed by one search for its tag that never starts again from the beginning. Tests run megabytes of each hostile shape and set a time limit |
| A string, a name, a comment or a dollar body is never closed, so the tool silently ignores the rest of the file | It is an error finding, `unterminated-token`, so the gate fails, and the rest of the file is reported as not read |
| A statement is skipped, and a check passes without having run | A statement that the tool cannot read is a warning (`unparsed-statement`); a missing semicolon is a warning; a `DO` block and a psql line are info findings; the number of statements without a check is a note |
| A table name or a file name rewrites the terminal through escape sequences, or reorders text with direction characters | Control characters (C0 and C1), line and paragraph separators and Unicode direction controls are replaced by a space before any text reaches a report or an error message, and the length is capped |
| A name breaks the Markdown table in the job summary, or hides text as an HTML tag | Pipes, backslashes, line breaks, `<`, `>` and `&` are escaped in every table cell |
| A CSV report runs a formula when opened in a spreadsheet | Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading `'`; every cell is quoted as RFC 4180 says |
| A secret in a migration (a value in an `INSERT`, a default, a comment) is copied into a report, a job log or the job summary | The tokenizer keeps no text of a string, a comment or a dollar-quoted body, and no value is copied into a finding; only names of files, tables and columns are shown. A test writes a marker value into every place a value can be and checks that no format prints it |
| The argument names a URL, so the tool becomes a fetcher | Arguments that look like addresses are refused; reading from standard input is refused |
| A pipe or a device in place of the file makes the tool hang | The type is looked at before the file is opened and again on the open file, and anything that is not a regular file is refused |
| A file name in a folder makes the order differ between systems | File names are compared by code unit, never by locale, and shown with forward slashes on every system |
| A key such as `__proto__` changes how objects behave | The tool builds no object from a name in the input, and compares names as strings in sets that are not keyed by plain objects |

## What the tool does not defend against

The person who runs the tool is trusted: the paths they give are read. A report written to a shared place is as sensitive as its names: table and column names can be confidential even though row data never appears.

# Secure defaults

The default run is the safe run. Nothing below needs a flag, and none of it can be switched off.

## How the tool behaves by default

- **No database and no network.** The tool reads the files it is given and sends nothing anywhere. It never connects to a database, never runs a migration, does not download a page of the manual, and does not check for updates. The manual pages are saved in the repository.
- **No commands.** The tool never runs a program, a shell, `git`, `psql` or a package manager. No name, path or value from a file is put on a command line.
- **No dependencies.** Node 22 or newer and nothing else, so a check that runs on a database's migrations adds no supply chain of its own. There is no `node_modules` to install before it runs.
- **Reads only what is named.** The tool opens the files you name and the `.sql` files of the folders you name, one level deep. A file never names another file for the tool to open.
- **Regular files only, bounded.** Each file is opened once, its type and size are taken from the open file, and anything that is not a regular file or is over 5 MB is refused before it is read. The total size and the number of files are bounded too.
- **Row data stays out of the report.** The tokenizer drops the text of every string, comment and dollar-quoted body, and no value of a statement is copied into a finding, a note or any format. A finding names the file, the line, the kind of statement and the names of the tables and columns involved, which are names from the schema, not data.
- **Clean output.** Text from a file (a path, a table name, a column name) has control characters, line separators and direction controls removed and its length capped before it reaches a report or an error message, so a hostile name cannot rewrite the terminal or reorder what a reader sees.
- **Strict formats.** In the Markdown report, pipes, backslashes, angle brackets and ampersands are escaped. In the CSV report, every cell is quoted as RFC 4180 says, and a cell that starts with `=`, `+`, `-` or `@` gets a leading quote so that a spreadsheet does not run it as a formula.
- **Linear time.** The tokenizer reads each character once and uses no pattern on the raw text, so a very long string, a run of quotes or deeply nested comments cannot make it run long. Tests run megabytes of hostile text.
- **Unread is never fine.** A string, a name or a comment that is never closed is an error, a file cut by a limit is an error, and a statement the tool could not read is a warning, not a skip. The count of statements that the tool understood but has no check for is in the report.
- **The gate is on.** Without any option, an error makes the run exit with `1`. A pipeline that adds the tool notices a `NOT NULL` column that cannot be added, an index built inside a transaction, and a `DROP`, a `TRUNCATE`, or a `DELETE` or `UPDATE` without `WHERE`, from the first run.
- **Writes nothing to disk.** The report goes to the screen. Redirect it to a file or the job summary only when you need to keep it.

## Running it safely on migrations you do not know

1. A migration file is data, and the tool treats it as data. Still, run it as a user with read access to the files and nothing else; it needs no account, no key and no network.
2. Read the notes and the info findings: they say what was not read (a `DO` block, a psql line) and what was cut, so a pass is not taken for more than it is.
3. Keep the files you check free of real secrets. The tool does not print values, but the files may travel through other tools of your pipeline.

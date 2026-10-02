# Inputs

The tool takes one or more paths: migration files, or folders of migration files. It reads those files and nothing else. It follows no include, opens no file that a file names, and connects to no database.

## The files

- **Plain SQL, PostgreSQL syntax.** The tool reads `.sql` files that hold PostgreSQL statements. It does not read the migration formats of a framework (a Ruby, Python, JavaScript, Java or Go migration class, an XML or YAML changelog, an `up` and `down` pair inside one file). The tools' own documents describe those formats, and none of them is saved among the sources of this repository, so none is read. Export or write the SQL that the migration runs, and give the tool that file.
- **PostgreSQL only.** The MySQL manual is not among the sources, and the checks are written from the PostgreSQL manual. A MySQL file is read as PostgreSQL text, and the findings for it mean nothing.
- **Encoding.** The text is read as UTF-8. A byte order mark at the start of a file is ignored. Line ends can be LF, CRLF or CR.
- **Size.** A file over 5 MB is refused from the size of the open file, before it is read. All files together over 50 MB are refused. More than 5,000 files are refused. A folder, a pipe or a device given as a file is refused.

## Folders and order

- A folder gives its `.sql` files (the extension in any case), one level deep, in **name order**: the names are compared by code unit, so `002_a.sql` comes before `010_b.sql` and `UPPER.sql` comes before `lower.sql`, the same on every system and in every locale. Subfolders are not read. A name that is not a regular `.sql` file is ignored, and the report counts the ignored entries. A folder with no `.sql` file is an error.
- Files named one by one are read in the order given. Arguments can be mixed: the order of the arguments is the order in which the migrations are applied.
- A file named twice is read once, and the report says so.
- Numbers in names are not read as numbers. Write them with leading zeros (`002`, `010`) so that name order is the order of application. A migration tool that orders versions differently has to be given the files in its order, one by one.

## `--since`

`--since <file>` names the first migration that is still to be applied. It is the shown path of one of the files given (`db/migrations/004_add_phone.sql`) or just its file name (`004_add_phone.sql`) when that is not ambiguous. The files before it are read only to learn which tables exist: a table they create is an existing table, not a new one, and nothing in them is reported (not even a file that cannot be read to the end). The files from it on are checked in full. A name that matches no file, or more than one, is an error with exit code `2`.

Without `--since`, the whole set is checked and every table that a file of the set creates is new for the statements after it ([method.md](method.md), "Which table a statement is about").

## What is read from a statement

Only the structure that a check needs: the command, the name of the table or column, the keywords around it (`CONCURRENTLY`, `NOT NULL`, `DEFAULT`, `NOT VALID`, `WHERE`, `IN ... MODE`, `FULL`), and, for a `DEFAULT` of `ADD COLUMN`, the names of the functions that it calls. The text of a string, a comment, a dollar-quoted body and the values of a statement are dropped by the tokenizer and never reach a finding.

## What is not read

- A psql line that starts with a backslash is listed (`meta-command`) and not read.
- The body of a `DO` block is a string: it is not read (`do-block-not-read`).
- A statement that starts with a word that is not a command of the manual's list of SQL commands is reported (`unparsed-statement`) and not checked.
- A `CREATE FUNCTION` or `CREATE PROCEDURE` body, in a string or in `BEGIN ATOMIC ... END`, is a definition: it is not run when the migration runs, and it is not read.
- The data-changing statements inside the parentheses of a `WITH` list are not read.

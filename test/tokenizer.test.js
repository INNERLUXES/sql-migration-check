import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, splitStatements, TOKEN_LIMITS, STATEMENT_LIMITS } from '../src/index.js';

const types = (sql) => tokenize(sql).tokens.map((t) => t.t);
const words = (sql) => tokenize(sql).tokens.filter((t) => t.t === 'word').map((t) => t.u);

test('tokenizer: words, numbers, punctuation and parameters, with line numbers', () => {
  const { tokens, errors } = tokenize('SELECT a, 12\nFROM t WHERE x = $1;');
  assert.deepEqual(errors, []);
  assert.deepEqual(tokens.map((t) => t.t), ['word', 'word', 'punct', 'number', 'word', 'word', 'word', 'word', 'op', 'param', 'punct']);
  assert.equal(tokens[0].line, 1);
  assert.equal(tokens[4].line, 2);
});

test('tokenizer: a line comment and a nested block comment hide what they hold', () => {
  assert.deepEqual(words('SELECT 1 -- DROP TABLE x;\n'), ['SELECT']);
  assert.deepEqual(words('SELECT /* a /* nested */ DROP TABLE x; */ 1'), ['SELECT']);
});

test('tokenizer: a string with a doubled quote and a semicolon is one token, and its text is not kept', () => {
  const { tokens } = tokenize("SELECT 'it''s; DROP TABLE x' AS v");
  assert.deepEqual(tokens.map((t) => t.t), ['word', 'string', 'word', 'word']);
  assert.equal(tokens[1].v, '');
  assert.ok(!JSON.stringify(tokens).includes('DROP'));
});

test('tokenizer: an E string takes backslash escapes, a plain string does not', () => {
  assert.deepEqual(types("SELECT E'a\\'b; c' , 1"), ['word', 'string', 'punct', 'number']);
  // in a plain string the backslash is an ordinary character, so the quote after it closes the string
  assert.deepEqual(types("SELECT 'a\\' , 1"), ['word', 'string', 'punct', 'number']);
});

test('tokenizer: quoted identifiers keep their name, with a doubled quote read as one quote', () => {
  const { tokens } = tokenize('ALTER TABLE "My ""Odd""; Table" ADD COLUMN x int');
  assert.equal(tokens[2].t, 'qident');
  assert.equal(tokens[2].v, 'My "Odd"; Table');
});

test('tokenizer: dollar-quoted bodies, with and without a tag, hide semicolons and other tags', () => {
  const sql = 'DO $$ BEGIN DELETE FROM a; END $$; DO $body$ x; $$ y; $body$;';
  const { tokens } = tokenize(sql);
  assert.deepEqual(tokens.map((t) => t.t), ['word', 'dollar', 'punct', 'word', 'dollar', 'punct']);
});

test('tokenizer: $1 is a parameter and a$b is one word, not a dollar quote', () => {
  assert.deepEqual(types('SELECT $1, a$b'), ['word', 'param', 'punct', 'word']);
  assert.deepEqual(words('SELECT a$b$ c'), ['SELECT', 'A$B$', 'C']);
});

test('tokenizer: a string, a name, a comment or a dollar body that is never closed is an error at its opening line', () => {
  assert.deepEqual(tokenize("SELECT 1;\nSELECT 'abc").errors, [{ kind: 'string', line: 2 }]);
  assert.deepEqual(tokenize('SELECT "abc').errors, [{ kind: 'quoted identifier', line: 1 }]);
  assert.deepEqual(tokenize('SELECT 1;\n\n/* open /* nested */').errors, [{ kind: 'comment', line: 3 }]);
  assert.deepEqual(tokenize('SELECT 1;\nDO $x$ never closed $$').errors, [{ kind: 'dollar-quoted body', line: 2 }]);
});

test('tokenizer: lines are counted for CRLF, LF and a lone CR, also inside strings and comments', () => {
  const sql = "A\r\nB\rC\n'x\r\ny'\n/* c\n*/ D";
  const lines = tokenize(sql).tokens.map((t) => [t.t, t.line]);
  assert.deepEqual(lines, [['word', 1], ['word', 2], ['word', 3], ['string', 4], ['word', 7]]);
});

test('tokenizer: a psql backslash command is one token that is not SQL', () => {
  const { tokens } = tokenize('\\connect clinic\nSELECT 1;');
  assert.equal(tokens[0].t, 'meta');
  assert.equal(tokens[1].line, 2);
});

test('tokenizer: B, X, N and U& prefixes make strings, and U& before a quote makes a name', () => {
  assert.deepEqual(types("SELECT B'101', X'ff', N'x', U&'d\\0061ta'"), ['word', 'string', 'punct', 'string', 'punct', 'string', 'punct', 'string']);
  assert.deepEqual(types('SELECT U&"n;ame"'), ['word', 'qident']);
});

test('tokenizer: hostile input of a few megabytes is read in linear time', () => {
  const started = Date.now();
  const cases = [
    "'".repeat(2000001),
    '/*'.repeat(1000000),
    '$a$'.repeat(600000),
    '"'.repeat(2000001),
    "E'\\".repeat(500000),
    '('.repeat(1000000),
    'a;'.repeat(500000)
  ];
  for (const text of cases) tokenize(text);
  assert.ok(Date.now() - started < 8000, 'every case finishes quickly');
});

test('tokenizer: the token limit stops the read and says so', () => {
  const { tokens, truncated } = tokenize('a b c d e f', { maxTokens: 3 });
  assert.equal(tokens.length, 3);
  assert.equal(truncated, true);
  assert.equal(TOKEN_LIMITS.maxTokens > 100000, true);
});

test('statements: a semicolon in a string, a name or a body does not end the statement', () => {
  const { statements } = splitStatements(tokenize("SELECT ';'; ALTER TABLE \"a;b\" ADD x int; DO $$ a; b; $$;").tokens);
  assert.equal(statements.length, 3);
  assert.deepEqual(statements.map((s) => s.line), [1, 1, 1]);
  assert.ok(statements.every((s) => s.terminated));
});

test('statements: empty statements are dropped and a last statement without a semicolon is marked', () => {
  const { statements } = splitStatements(tokenize(';;SELECT 1;;\nSELECT 2').tokens);
  assert.equal(statements.length, 2);
  assert.equal(statements[0].terminated, true);
  assert.equal(statements[1].terminated, false);
});

test('statements: a function body written with BEGIN ATOMIC holds its semicolons, also around a CASE', () => {
  const sql = 'CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT CASE WHEN true THEN 1 ELSE 2 END; SELECT 3; END; SELECT 4;';
  const { statements } = splitStatements(tokenize(sql).tokens);
  assert.equal(statements.length, 2);
  assert.equal(statements[0].tokens[0].u, 'CREATE');
  assert.equal(statements[1].tokens[0].u, 'SELECT');
});

test('statements: a plain BEGIN is a statement of its own, and psql lines are listed apart', () => {
  const { statements, meta } = splitStatements(tokenize('BEGIN;\n\\echo hi\nCREATE TABLE a (x int);\nCOMMIT;').tokens);
  assert.equal(statements.length, 3);
  assert.deepEqual(meta, [2]);
});

test('statements: the statement limit stops the split and says so', () => {
  const { statements, truncated } = splitStatements(tokenize('a; b; c; d;').tokens, { maxStatements: 2 });
  assert.equal(statements.length, 2);
  assert.equal(truncated, true);
  assert.equal(STATEMENT_LIMITS.maxStatements > 1000, true);
});

// Reads the migration files, runs the checks of src/rules.js on every statement in order and returns one report. The tool
// reads the files it is given and opens no connection. docs/method.md gives the reason behind every finding.

import { FACTS, MANUAL_BASE, sourceUrl, SOURCES } from './data.js';
import { FILE_LIMITS, collectFiles, displayPath, readBounded } from './files.js';
import { FINDINGS, ORDER, RANK, SEVERITIES, analyzeStatements, createState, meetsThreshold, safeText } from './rules.js';
import { splitStatements, STATEMENT_LIMITS } from './statements.js';
import { TOKEN_LIMITS, tokenize } from './tokenizer.js';

export const LIMITS = { ...FILE_LIMITS, ...TOKEN_LIMITS, ...STATEMENT_LIMITS, maxMetaFindings: 20 };
export { FINDINGS, RANK, SEVERITIES, meetsThreshold, safeText };

const BY_ID = Object.fromEntries(FINDINGS.map((f) => [f.id, f]));
const sourceTitle = (id) => SOURCES.find((s) => s.id === id).title;

function plural(count, one, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

// The sentences of the manual that a finding quotes.
export function manualFor(id, extraFacts = []) {
  for (const key of extraFacts) if (!(BY_ID[id].optional ?? []).includes(key)) throw new Error(`${id} does not quote ${key}`);
  return [...BY_ID[id].facts, ...extraFacts].map((key) => {
    const fact = FACTS[key];
    return { page: sourceTitle(fact.source), section: fact.section, url: sourceUrl(fact.source), quote: fact.text };
  });
}

// Reports on the text of one or more files. inputs is a list of { path, text }: path is the name shown and the order is
// the order in which the migrations are applied. since is the shown name of the first file that is still to be applied;
// the files before it are read only to learn which tables exist.
export function checkTexts(inputs, { failOn = 'error', version = '0.0.0', since = null, limits = LIMITS } = {}) {
  let sinceIndex = 0;
  if (since !== null) {
    const matches = inputs.map((f, i) => (f.path === since ? i : -1)).filter((i) => i >= 0);
    const byName = matches.length ? matches : inputs.map((f, i) => (f.path.split('/').pop() === since ? i : -1)).filter((i) => i >= 0);
    if (byName.length === 0) throw new Error(`--since ${safeText(since, 120)} is not one of the files given`);
    if (byName.length > 1) throw new Error(`--since ${safeText(since, 120)} names more than one file; give the path as it is shown`);
    sinceIndex = byName[0];
  }

  const state = createState();
  const found = [];
  const files = [];
  const totals = { statements: 0, checked: 0, recognized: 0, unparsed: 0 };
  let metaUnlisted = 0;

  inputs.forEach((input, index) => {
    const baseline = index < sinceIndex;
    const text = input.text.charCodeAt(0) === 0xfeff ? input.text.slice(1) : input.text;
    const emit = (id, line, fields) => {
      if (baseline) return;
      found.push({
        id,
        severity: BY_ID[id].severity,
        file: input.path,
        fileIndex: index,
        line,
        statement: fields.statement,
        table: fields.table ?? null,
        message: fields.message,
        fix: fields.fix,
        manual: manualFor(id, fields.extraFacts ?? [])
      });
    };
    const { tokens, errors, truncated: tokensCut } = tokenize(text, limits);
    const { statements, meta, truncated: statementsCut } = splitStatements(tokens, limits);
    if (errors.length && statements.length) statements[statements.length - 1].terminated = true;
    const counts = analyzeStatements(statements, { state, emit, baseline });
    for (const e of errors) {
      emit('unterminated-token', e.line, {
        statement: 'file',
        table: null,
        message: `A ${e.kind} that opens here is never closed. Nothing after this line was read, so the rest of the file was not checked.`,
        fix: `Close the ${e.kind}.`
      });
    }
    if (tokensCut || statementsCut) {
      emit('limit-reached', statements.length ? statements[statements.length - 1].line : 1, {
        statement: 'file',
        table: null,
        message: 'The file has more tokens or statements than the limits allow, so the rest of the file was not checked.',
        fix: 'Split the file into smaller migrations.'
      });
    }
    for (const line of meta.slice(0, limits.maxMetaFindings)) {
      emit('meta-command', line, {
        statement: 'psql command',
        table: null,
        message: 'A line that starts with a backslash is a psql command, not SQL. The tool does not read it.',
        fix: 'Keep psql commands out of migration files, or check by hand what this one does.'
      });
    }
    metaUnlisted += Math.max(0, meta.length - limits.maxMetaFindings);
    if (!baseline) {
      totals.statements += statements.length;
      totals.checked += counts.checked;
      totals.recognized += counts.recognized;
      totals.unparsed += counts.unparsed;
    }
    files.push({ path: safeText(input.path, 400), statements: statements.length, baseline });
  });

  found.sort((a, b) => a.fileIndex - b.fileIndex || a.line - b.line || ORDER[a.id] - ORDER[b.id] || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
  const findings = found.map(({ fileIndex, ...rest }) => ({ ...rest, file: safeText(rest.file, 400) }));

  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;

  const notes = [];
  if (sinceIndex > 0) notes.push(`${plural(sinceIndex, 'file')} before ${safeText(inputs[sinceIndex].path, 200)} ${sinceIndex === 1 ? 'was' : 'were'} read only to learn which tables already exist; nothing in ${sinceIndex === 1 ? 'it' : 'them'} is reported`);
  if (totals.statements === 0) notes.push('No statement was found, so there was nothing to check');
  if (totals.recognized > 0) notes.push(`${plural(totals.recognized, 'statement')} ${totals.recognized === 1 ? 'was' : 'were'} understood but ${totals.recognized === 1 ? 'has' : 'have'} no check (for example SELECT, INSERT and CREATE TABLE)`);
  if (metaUnlisted > 0) notes.push(`${plural(metaUnlisted, 'more psql command')} ${metaUnlisted === 1 ? 'was' : 'were'} not listed; the report lists the first ${limits.maxMetaFindings} of each file`);

  const failing = findings.filter((f) => meetsThreshold(f.severity, failOn));
  const eCount = failing.filter((f) => f.severity === 'error').length;
  const wCount = failing.filter((f) => f.severity === 'warning').length;
  const reason = [eCount ? plural(eCount, 'error') : null, wCount ? plural(wCount, 'warning') : null].filter(Boolean).join(', ');

  return {
    tool: 'sql-migration-check',
    version,
    dialect: 'PostgreSQL',
    manual: MANUAL_BASE,
    input: { files, statements: totals.statements, checked: totals.checked, recognized: totals.recognized, unparsed: totals.unparsed },
    findings,
    notes,
    counts,
    gate: { failOn, pass: failing.length === 0, reason }
  };
}

// Reads the files (or the .sql files of the folders) and builds the report. Paths in the report are relative to base,
// with forward slashes.
export async function checkFiles(args, { failOn = 'error', version = '0.0.0', since = null, limits = LIMITS, base = process.cwd() } = {}) {
  const { files, skipped, duplicates } = await collectFiles(args, base, limits);
  const inputs = [];
  let total = 0;
  for (const full of files) {
    let buffer;
    try {
      buffer = await readBounded(full, limits.maxFileBytes);
    } catch (error) {
      throw new Error(`${displayPath(full, base)}: ${error.reason ?? error.message}`);
    }
    total += buffer.length;
    if (total > limits.maxTotalBytes) throw new Error(`the files together are over the ${(limits.maxTotalBytes / 1048576).toLocaleString('en-US')} MB limit`);
    inputs.push({ path: displayPath(full, base), text: buffer.toString('utf8') });
  }
  const report = checkTexts(inputs, { failOn, version, since, limits });
  if (skipped > 0) report.notes.push(`${plural(skipped, 'entry', 'entries')} in the folders ${skipped === 1 ? 'was' : 'were'} not a .sql file and ${skipped === 1 ? 'was' : 'were'} ignored`);
  if (duplicates > 0) report.notes.push(`${plural(duplicates, 'file')} named twice ${duplicates === 1 ? 'was' : 'were'} read once`);
  return report;
}

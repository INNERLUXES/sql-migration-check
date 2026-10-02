// Report formats: text for a terminal, Markdown for a pull request or job summary, JSON for other tools, CSV for a
// spreadsheet. Findings are listed in the order the migrations are applied: by file, then by line. A finding names the
// statement, never copies one: no value of a row and no text of a statement is in a report.

function plural(count, one, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

function countsLine(c) {
  return `${c.error} error, ${c.warning} warning, ${c.info} info`;
}

function gateLine(r) {
  return r.gate.pass ? `GATE: PASS (--fail-on ${r.gate.failOn})` : `GATE: FAIL - ${r.gate.reason}`;
}

function inputLine(r) {
  const earlier = r.input.files.filter((f) => f.baseline).length;
  const checked = r.input.files.length - earlier;
  return `${plural(checked, 'file')} checked, ${plural(r.input.statements, 'statement')}${earlier ? `, ${plural(earlier, 'earlier file')} read for the table names` : ''}`;
}

// The files read: the one path, or the first and the last of a set.
function filesLine(r) {
  const files = r.input.files;
  return files.length === 1 ? files[0].path : `${files[0].path} ... ${files[files.length - 1].path}`;
}

const sectionOf = (m) => (m.section === m.page ? m.page : `${m.page}, ${m.section}`);

export function toText(r) {
  const lines = [`sql-migration-check: ${filesLine(r)}`, `dialect: ${r.dialect} (manual: ${r.manual})`, `read: ${inputLine(r)}`, `findings: ${countsLine(r.counts)}`];
  if (!r.findings.length) lines.push('', 'no findings');
  for (const f of r.findings) {
    lines.push('', `${f.severity.toUpperCase().padEnd(7)}  ${f.id}  ${f.file}:${f.line}`);
    lines.push(`         statement: ${f.statement}${f.table ? `, table: ${f.table}` : ''}`);
    lines.push(`         ${f.message}`, `         fix: ${f.fix}`);
    for (const m of f.manual) lines.push(`         manual (${sectionOf(m)}): "${m.quote}"`, `           ${m.url}`);
  }
  if (r.notes.length) lines.push('');
  for (const note of r.notes) lines.push(`note: ${note}`);
  lines.push('', gateLine(r));
  return lines.join('\n') + '\n';
}

// A Markdown table cell: backslashes and pipes escaped, line breaks flattened, and <, > and & written as entities, so
// text from a file name or a table name cannot break the table or be read as HTML.
export function mdCell(t) {
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n|\r/g, ' ');
}

export function toMarkdown(r) {
  const lines = [`## sql-migration-check: ${countsLine(r.counts)}`, '', `${mdCell(r.dialect)}, ${mdCell(inputLine(r))}. Manual: ${r.manual}`];
  if (!r.findings.length) lines.push('', 'No findings.');
  else {
    lines.push('', '| Severity | Check | Where | Statement | Message | Fix | Manual |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const f of r.findings) {
      const manual = f.manual.map((m) => `[${mdCell(sectionOf(m))}](${m.url}): "${mdCell(m.quote)}"`).join('<br>');
      lines.push(`| ${f.severity} | ${mdCell(f.id)} | ${mdCell(`${f.file}:${f.line}`)} | ${mdCell(f.statement)}${f.table ? mdCell(` on ${f.table}`) : ''} | ${mdCell(f.message)} | ${mdCell(f.fix)} | ${manual || '-'} |`);
    }
  }
  if (r.notes.length) lines.push('');
  for (const note of r.notes) lines.push(`- ${mdCell(note)}`);
  lines.push('', r.gate.pass ? `**Gate passed** (--fail-on ${r.gate.failOn}).` : `**Gate failed:** ${mdCell(r.gate.reason)}.`);
  return lines.join('\n') + '\n';
}

export function toJson(r) {
  return JSON.stringify(r, null, 2) + '\n';
}

// RFC 4180 quoting, and a leading quote on cells a spreadsheet would read as a formula.
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per finding. manual_section and manual_url name the first sentence the finding quotes; the JSON report has all
// of them.
export function toCsv(r) {
  const rows = [['severity', 'id', 'file', 'line', 'statement', 'table', 'message', 'fix', 'manual_page', 'manual_section', 'manual_url']];
  for (const f of r.findings) {
    const m = f.manual[0];
    rows.push([f.severity, f.id, f.file, String(f.line), f.statement, f.table ?? '', f.message, f.fix, m ? m.page : '', m ? m.section : '', m ? m.url : '']);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

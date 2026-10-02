// Splits the tokens of one file into statements. A statement ends at a semicolon. The only semicolons that do not end
// a statement are the ones inside a string, a quoted name or a dollar-quoted body (the tokenizer already made each of
// those one token) and the ones in the body of a CREATE FUNCTION or CREATE PROCEDURE written with BEGIN ATOMIC ... END,
// which holds statements of its own. A statement that is not followed by a semicolon at the end of the file is
// returned with terminated: false.

export const STATEMENT_LIMITS = {
  maxStatements: 200000
};

// Returns { statements, meta, truncated }. A statement is { tokens, line, terminated }. meta lists the lines of psql
// backslash commands, which are not SQL.
export function splitStatements(tokens, limits = STATEMENT_LIMITS) {
  const statements = [];
  const meta = [];
  let current = [];
  let atomic = false;
  let atomicClosed = false;
  let caseDepth = 0;
  let truncated = false;

  const flush = (terminated) => {
    if (current.length) statements.push({ tokens: current, line: current[0].line, terminated });
    current = [];
    atomic = false;
    atomicClosed = false;
    caseDepth = 0;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (statements.length >= limits.maxStatements) {
      truncated = true;
      break;
    }
    if (tok.t === 'meta') {
      meta.push(tok.line);
      continue;
    }
    if (tok.t === 'punct' && tok.v === ';') {
      if (atomic && !atomicClosed) {
        current.push(tok);
        continue;
      }
      flush(true);
      continue;
    }
    current.push(tok);
    if (tok.t !== 'word') continue;
    if (!atomic && tok.u === 'BEGIN' && current.length > 1 && current[0].u === 'CREATE') {
      const next = tokens[i + 1];
      if (next && next.t === 'word' && next.u === 'ATOMIC') atomic = true;
    } else if (atomic && !atomicClosed) {
      if (tok.u === 'CASE') caseDepth += 1;
      else if (tok.u === 'END') {
        if (caseDepth > 0) caseDepth -= 1;
        else atomicClosed = true;
      }
    }
  }
  if (!truncated) flush(false);
  return { statements, meta, truncated };
}

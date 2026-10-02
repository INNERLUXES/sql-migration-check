// A tokenizer for PostgreSQL text. It reads the file once, from left to right, character by character, and never
// runs a pattern over the raw text, so the time is linear in the size of the input. It knows the parts of the
// language that decide where a statement ends: comments (nested block comments too), 'strings' (also E'..' with
// backslash escapes), "quoted identifiers", $tag$ dollar-quoted bodies$tag$, and psql lines that start with a
// backslash. The content of a string, a quoted body or a comment is never kept in a token, so no row data can reach a
// report from here.
//
// Token types: word (an unquoted name or keyword, with .u its upper-case form), qident (a quoted identifier, .v holds
// the name), string, dollar, number, param ($1), punct ( ( ) , ; . [ ] ), op (any other single character) and meta (a
// psql backslash line).

export const TOKEN_LIMITS = {
  maxTokens: 2000000
};

const isDigit = (c) => c >= 48 && c <= 57;
const isLetter = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c > 127;
const isWordChar = (c) => isLetter(c) || isDigit(c) || c === 36;
const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11;

// Returns { tokens, errors, truncated }. An error is { kind, line } for a string, a quoted identifier, a comment or a
// dollar-quoted body that is never closed; the tokens before it are kept and the rest of the text is not read.
export function tokenize(text, limits = TOKEN_LIMITS) {
  const tokens = [];
  const errors = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let truncated = false;

  const push = (t, v, u, atLine) => {
    tokens.push({ t, v, u, line: atLine });
  };

  while (i < n) {
    if (tokens.length >= limits.maxTokens) {
      truncated = true;
      break;
    }
    const c = text.charCodeAt(i);
    if (c === 10) {
      line += 1;
      i += 1;
      continue;
    }
    if (c === 13) {
      if (text.charCodeAt(i + 1) !== 10) line += 1;
      i += 1;
      continue;
    }
    if (isSpace(c)) {
      i += 1;
      continue;
    }
    const startLine = line;

    // -- comment
    if (c === 45 && text.charCodeAt(i + 1) === 45) {
      i += 2;
      while (i < n && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i += 1;
      continue;
    }
    // /* comment */, which nests in PostgreSQL
    if (c === 47 && text.charCodeAt(i + 1) === 42) {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        const d = text.charCodeAt(i);
        if (d === 47 && text.charCodeAt(i + 1) === 42) {
          depth += 1;
          i += 2;
        } else if (d === 42 && text.charCodeAt(i + 1) === 47) {
          depth -= 1;
          i += 2;
        } else {
          if (d === 10 || (d === 13 && text.charCodeAt(i + 1) !== 10)) line += 1;
          i += 1;
        }
      }
      if (depth > 0) {
        errors.push({ kind: 'comment', line: startLine });
        break;
      }
      continue;
    }
    // psql meta-command: a backslash, to the end of the line
    if (c === 92) {
      while (i < n && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i += 1;
      push('meta', '', null, startLine);
      continue;
    }
    // 'string'
    if (c === 39) {
      const end = scanQuoted(text, i, 39, false);
      line += end.lines;
      if (end.closed === false) {
        errors.push({ kind: 'string', line: startLine });
        break;
      }
      i = end.next;
      push('string', '', null, startLine);
      continue;
    }
    // "quoted identifier"
    if (c === 34) {
      const end = scanQuoted(text, i, 34, false);
      line += end.lines;
      if (end.closed === false) {
        errors.push({ kind: 'quoted identifier', line: startLine });
        break;
      }
      const name = text.slice(i + 1, end.next - 1).split('""').join('"');
      i = end.next;
      push('qident', name, null, startLine);
      continue;
    }
    // $1 parameter, or $tag$ ... $tag$
    if (c === 36) {
      let j = i + 1;
      if (isDigit(text.charCodeAt(j))) {
        while (isDigit(text.charCodeAt(j))) j += 1;
        i = j;
        push('param', '', null, startLine);
        continue;
      }
      if (text.charCodeAt(j) !== 36 && !isLetter(text.charCodeAt(j))) {
        i += 1;
        push('op', '$', null, startLine);
        continue;
      }
      while (j < n && text.charCodeAt(j) !== 36 && isWordChar(text.charCodeAt(j))) j += 1;
      if (text.charCodeAt(j) === 36) {
        const tag = text.slice(i, j + 1);
        const close = text.indexOf(tag, j + 1);
        if (close === -1) {
          errors.push({ kind: 'dollar-quoted body', line: startLine });
          break;
        }
        for (let k = j + 1; k < close; k += 1) {
          const d = text.charCodeAt(k);
          if (d === 10 || (d === 13 && text.charCodeAt(k + 1) !== 10)) line += 1;
        }
        i = close + tag.length;
        push('dollar', '', null, startLine);
        continue;
      }
      i += 1;
      push('op', '$', null, startLine);
      continue;
    }
    if (isDigit(c)) {
      let j = i + 1;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (isDigit(d) || isLetter(d) || d === 46) j += 1;
        else break;
      }
      i = j;
      push('number', '', null, startLine);
      continue;
    }
    if (isLetter(c)) {
      let j = i + 1;
      while (j < n && isWordChar(text.charCodeAt(j))) j += 1;
      const word = text.slice(i, j);
      const next = text.charCodeAt(j);
      const upper = word.toUpperCase();
      // E'...' has backslash escapes; B'..', X'..' and N'..' are plain strings; U&'..' and U&".." are strings and names.
      if (next === 39 && (upper === 'E' || upper === 'B' || upper === 'X' || upper === 'N')) {
        const end = scanQuoted(text, j, 39, upper === 'E');
        line += end.lines;
        if (end.closed === false) {
          errors.push({ kind: 'string', line: startLine });
          break;
        }
        i = end.next;
        push('string', '', null, startLine);
        continue;
      }
      if (upper === 'U' && next === 38 && (text.charCodeAt(j + 1) === 39 || text.charCodeAt(j + 1) === 34)) {
        const quote = text.charCodeAt(j + 1);
        const end = scanQuoted(text, j + 1, quote, false);
        line += end.lines;
        if (end.closed === false) {
          errors.push({ kind: quote === 39 ? 'string' : 'quoted identifier', line: startLine });
          break;
        }
        const name = quote === 34 ? text.slice(j + 2, end.next - 1).split('""').join('"') : '';
        i = end.next;
        push(quote === 34 ? 'qident' : 'string', name, null, startLine);
        continue;
      }
      i = j;
      push('word', word, upper, startLine);
      continue;
    }
    i += 1;
    if (c === 40 || c === 41 || c === 44 || c === 59 || c === 46 || c === 91 || c === 93) push('punct', String.fromCharCode(c), null, startLine);
    else push('op', String.fromCharCode(c), null, startLine);
  }
  return { tokens, errors, truncated };
}

// Scans a quoted text that starts at text[start], which is the opening quote. A doubled quote is a quote inside the
// text; with backslash escapes, a backslash takes the next character. Returns where the text ends, how many line
// breaks it held, and whether it was closed.
function scanQuoted(text, start, quote, backslash) {
  const n = text.length;
  let i = start + 1;
  let lines = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (backslash && c === 92) {
      const d = text.charCodeAt(i + 1);
      if (d === 10 || (d === 13 && text.charCodeAt(i + 2) !== 10)) lines += 1;
      i += 2;
      continue;
    }
    if (c === quote) {
      if (text.charCodeAt(i + 1) === quote) {
        i += 2;
        continue;
      }
      return { next: i + 1, lines, closed: true };
    }
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) lines += 1;
    i += 1;
  }
  return { next: n, lines, closed: false };
}

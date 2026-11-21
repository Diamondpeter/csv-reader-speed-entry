// Fast csv-reader 1.0.0 drop-in (pass 2).
// Own implementation matching csv-reader's exact broken-CSV semantics.
// Strategy: per record, slice to the next LF and check for a quote —
// records with no quote take a split(',') fast path; records with a quote
// go through a field parser that uses indexOf/slice bulk operations
// instead of per-character loops. Field results are passed through
// mutable slots (no per-field result objects) to keep allocation low.
// Line/error semantics mirror the reference exactly.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const len = text.length;
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // Slots for the field just read: value, how it ended, chars appended
  // by the unquoted read (for the quote_junk check).
  let fv = '';
  let fe = END;
  let fa = 0;

  // Remove stray CRs from a field segment, recording one stray_cr error
  // per CR. When `terminator` is true the segment's final CR is the CRLF
  // terminator of its line break: dropped, but no error.
  function cleanStray(seg, terminator) {
    if (seg.indexOf('\r') === -1) return seg;
    let out = '';
    let start = 0;
    const last = seg.length - 1;
    for (let i = 0; i < seg.length; i++) {
      if (seg.charCodeAt(i) === 13) {
        if (!(terminator && i === last)) {
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        }
        out += seg.slice(start, i);
        start = i + 1;
      }
    }
    out += seg.slice(start);
    return out;
  }

  // Read one unquoted field starting at pos, with `init` as its starting
  // value ('' for a plain field, the quoted value for quote junk).
  // Sets fv/fe/fa. A field ends at the next comma, the next LF/CRLF, or
  // the end of the text; a CR not followed by LF inside it is dropped
  // with a stray_cr error.
  function readUnquoted(init) {
    const iC = text.indexOf(',', pos);
    if (iC !== -1) {
      const seg = text.slice(pos, iC);
      const nIn = seg.indexOf('\n');
      if (nIn === -1) {
        pos = iC + 1;
        const s = cleanStray(seg, false);
        fv = init === '' ? s : init + s;
        fa = s.length;
        fe = COMMA;
        return;
      }
      // A line break sits before the next comma: the field ends there.
      let s = seg.slice(0, nIn);
      pos = pos + nIn + 1;
      line += 1;
      s = cleanStray(s, s.charCodeAt(s.length - 1) === 13);
      fv = init === '' ? s : init + s;
      fa = s.length;
      fe = LINE_BREAK;
      return;
    }
    const iN = text.indexOf('\n', pos);
    if (iN === -1) {
      const s = cleanStray(text.slice(pos), false);
      pos = len;
      fv = init === '' ? s : init + s;
      fa = s.length;
      fe = END;
      return;
    }
    let s = text.slice(pos, iN);
    pos = iN + 1;
    line += 1;
    s = cleanStray(s, s.charCodeAt(s.length - 1) === 13);
    fv = init === '' ? s : init + s;
    fa = s.length;
    fe = LINE_BREAK;
  }

  // Read one quoted field whose opening quote is at pos. Sets fv/fe/fa
  // (fa is only meaningful for the quote-junk path, which sets it via
  // readUnquoted).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let value = '';
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // Never closes: the quote is literal and the text after it is
        // re-read as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      const seg = text.slice(pos, q);
      if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
        if (text.charCodeAt(q + 1) === 34) {
          value += seg;
          value += '"';
          pos = q + 2;
          continue;
        }
        value += seg;
        pos = q + 1;
        break;
      }
      // Line breaks inside quotes: each LF, CRLF and lone CR is one LF.
      const breaks = seg.match(/\r\n|\r|\n/g);
      if (breaks !== null) line += breaks.length;
      value += seg.replace(/\r\n|\r/g, '\n');
      pos = q;
    }
    if (pos >= len) {
      fv = value;
      fe = END;
      fa = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fv = value;
      fe = COMMA;
      fa = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fv = value;
      fe = LINE_BREAK;
      fa = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fv = value;
      fe = LINE_BREAK;
      fa = 0;
      return;
    }
    // Junk after the closing quote, appended as it stands.
    readUnquoted(value);
    if (fa > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    const n = text.indexOf('\n', pos);
    const segEnd = n === -1 ? len : n;
    const seg = text.slice(pos, segEnd);

    let fields;
    let lastQuoted = false;
    if (seg.indexOf('"') === -1) {
      // Fast path: no quote in this record.
      let s = seg;
      if (n !== -1 && s.charCodeAt(s.length - 1) === 13) s = s.slice(0, -1);
      fields = s.split(',');
      if (s.indexOf('\r') !== -1) {
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          if (f.indexOf('\r') !== -1) fields[i] = cleanStray(f, false);
        }
      }
      if (n === -1) {
        pos = len;
      } else {
        pos = n + 1;
        line += 1;
      }
    } else {
      fields = [];
      do {
        lastQuoted = text.charCodeAt(pos) === 34;
        if (lastQuoted) readQuoted();
        else readUnquoted('');
        fields.push(fv);
      } while (fe === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

[![make.fun competition](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![make.fun rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Diamondpeter/csv-reader-speed-entry/rank.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![make.fun reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Diamondpeter/csv-reader-speed-entry/reward.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)

# Read broken CSV files faster

A fast, dependency-free drop-in replacement for make.fun's own csv-reader 1.0.0.
`solve.js` exports `run({text, header})` returning exactly `{columns, rows, errors}` —
the same answers csv-reader gives on every input, including its broken-row policy
(BOM dropped, LF/CRLF record ends, stray CRs, doubled quotes, quote junk,
unterminated quotes, short/long rows) — at roughly 5× less CPU time on the
practice set (~90 ms vs ~450 ms for the house baseline's `run()` over the 6 cases).

How it gets fast: each record is sliced to its next LF and checked for a quote.
Records with no quote take a `split(',')` fast path; records with a quote go
through a field parser built on `indexOf`/`slice` bulk operations instead of
per-character loops, with field results passed through mutable slots to keep
allocation low. No regexes on hot paths, no caching between cases, no
special-casing of any input set.

## Run it

Requires Node 22.

```sh
node main.ts
```

`main.ts` reads `/input/cases.json` (or `$MAKEFUN_INPUT_DIR/cases.json`) and
writes `/output/answers.json` (or `$MAKEFUN_OUTPUT_DIR/answers.json`), one
answer per case, in order.

## Layout

- `solve.js` — the fast reader (`run`)
- `main.ts` — the harness driver (reads cases, writes answers)

## License

MIT — see [LICENSE](LICENSE).

---

Built for the [make.fun bounty "Read broken CSV files faster"](https://make.fun/competitions/csv-reader-speed-01-run-20261121?ref=h68hpwev) — see also https://make.fun/r/h68hpwev

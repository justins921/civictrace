#!/usr/bin/env node
/**
 * Fail the build on an unbounded Supabase read.
 *
 * Why this exists
 * ---------------
 * PostgREST silently caps an unbounded `select()` at 1000 rows. It returns 200,
 * it returns an array, and nothing anywhere says the array is a truncation. Any
 * `.length`, `.reduce()` or `.filter().length` on that array then prints a
 * number that is wrong, on a site whose entire proposition is that its numbers
 * are not wrong.
 *
 * Four outside reviews have found this defect seven times, in seven different
 * files. Every one of those instances was written after the previous one was
 * fixed and commented. A rule that lives in a comment is a rule that ships
 * broken, so this walks the AST instead.
 *
 * The invariant
 * -------------
 * Every `db.from(...)` chain must terminate in exactly one of:
 *
 *   * `{ count: 'exact' }` or `{ count: 'exact', head: true }` — asking for a
 *     number rather than rows;
 *   * `.limit(n)` — the top n, where n is deliberate and n is the point;
 *   * `.range(a, b)` — one page of a paged read;
 *   * `.maybeSingle()` / `.single()` — exactly one row.
 *
 * Reading a whole table is still allowed, but it has to say so out loud, by
 * going through `fetchAll()` in lib/db.ts, which pages to exhaustion and throws
 * rather than truncating. `fetchAll` and `countRows` are themselves the only
 * exemptions, marked by the comment directive below.
 *
 * Escape hatch: `// bounds-ok: <reason>` on the line above the call. It takes a
 * reason because "I checked and this table has nine rows" is a fact that ages,
 * and the next reader deserves to know which fact they are re-checking.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const DIRS = ['app', 'lib', 'components']
const EXEMPT_FILE = 'lib/db.ts'          // where countRows/fetchAll are defined
// `csv()` was in this list and bounds nothing — it changes the response format.
// PostgREST's server-side ceiling is the real limit; anything asking for more
// than this is asking for a number it will not get.
const MAX_ROWS = 1000
const BOUNDED = new Set(['limit', 'range', 'single', 'maybeSingle'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name === '.next') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

/** Walk up an outer call/member chain from `db.from(...)`, collecting method
 *  names, and report whether any of them bounds the read. */
function chainIsBounded(node, sf) {
  let cur = node
  let bounded = false
  for (;;) {
    const parent = cur.parent
    if (ts.isPropertyAccessExpression(parent) && parent.expression === cur) {
      const call = parent.parent
      const name = parent.name.text
      if (BOUNDED.has(name)) bounded = true
      // A limit above PostgREST's own ceiling is a limit that does nothing.
      // `.limit(2000)` on a 2,419-row table returns 1,000 rows, HTTP 200, no
      // warning — the exact defect this script exists to prevent, wearing the
      // script's own approval.
      if ((name === 'limit' || name === 'range') && ts.isCallExpression(call)) {
        const nums = call.arguments.map(a =>
          ts.isNumericLiteral(a) ? Number(a.text) : null)
        const span = name === 'limit'
          ? nums[0]
          : (nums[0] != null && nums[1] != null ? nums[1] - nums[0] + 1 : null)
        if (span != null && span > MAX_ROWS) overLimit.push({ node, span, name })
      }
      if (name === 'select' && ts.isCallExpression(call)) {
        // `count: 'exact'` without `head: true` returns a correct count
        // *alongside truncated rows*. Reducing over those rows is the
        // seven-times bug, so the count only bounds the read when it is asking
        // for a number instead of rows.
        const opts = call.arguments[1]
        if (opts && ts.isObjectLiteralExpression(opts)) {
          const has = (k) => opts.properties.some(
            (p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === k &&
                   p.initializer.kind !== ts.SyntaxKind.FalseKeyword)
          if (has('count') && has('head')) bounded = true
        }
      }
      if (!ts.isCallExpression(call)) return bounded
      cur = call
      continue
    }
    // `only(db.from(x).select(...)).limit(n)` — the chain passes through a
    // helper call and comes out the other side. Keep walking from the call.
    if (ts.isCallExpression(parent) && parent.arguments.includes(cur)) {
      cur = parent
      continue
    }
    // `let q = db.from(x).select(...)` then `q = q.eq(...)` then `q.range(...)`
    // — the chain leaves the expression. Assume the variable is bounded later
    // only if this file bounds it somewhere; that is what the variable pass
    // below handles, so stop here.
    return bounded
  }
}

const problems = []
const overLimit = []

for (const dir of DIRS) {
  let files
  try { files = walk(join(ROOT, dir)) } catch { continue }
  for (const file of files) {
    const rel = relative(ROOT, file)
    if (rel === EXEMPT_FILE) continue
    const src = readFileSync(file, 'utf8')
    const lines = src.split('\n')
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)

    // Names of local variables that hold a query and are bounded somewhere in
    // the *enclosing function*. `let qy = db.from(...); qy = qy.eq(...);
    // qy = qy.range(...)` is a legitimate shape and must not trip the check —
    // but scoping this to the whole file meant two functions both using `let q`,
    // one bounded and one not, passed silently.
    const enclosing = (n) => {
      let x = n
      while (x && !ts.isFunctionDeclaration(x) && !ts.isArrowFunction(x) &&
             !ts.isFunctionExpression(x) && !ts.isMethodDeclaration(x)) x = x.parent
      return x || sf
    }
    const boundedVars = new Map()   // function node -> Set<name>
    // The bound is often several links down a chain — `q.order(..).limit(n)` —
    // so resolve the identifier the chain is rooted at rather than only
    // accepting `q.limit(n)` written directly. Without this the checker
    // reported a false positive on a query that was bounded two calls later,
    // which is the fastest way to teach people to reach for the escape hatch.
    const rootIdent = (n) => {
      while (n && (ts.isPropertyAccessExpression(n) || ts.isCallExpression(n))) n = n.expression
      return n && ts.isIdentifier(n) ? n.text : null
    }
    const collect = (n) => {
      if (ts.isPropertyAccessExpression(n) && BOUNDED.has(n.name.text)) {
        const base = rootIdent(n.expression)
        if (base) {
          const fn = enclosing(n)
          if (!boundedVars.has(fn)) boundedVars.set(fn, new Set())
          boundedVars.get(fn).add(base)
        }
      }
      ts.forEachChild(n, collect)
    }
    collect(sf)

    const visit = (node) => {
      // `db.from(...)` and `writeClient().from(...)` only. `Array.from(...)` is
      // not a database read and the first version of this script said it was.
      const isClient = (e) =>
        (ts.isIdentifier(e) && (e.text === 'db' || e.text === 'client' || e.text === 'sb')) ||
        (ts.isCallExpression(e) && ts.isIdentifier(e.expression) &&
          e.expression.text === 'writeClient')
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'from' &&
        isClient(node.expression.expression)
      ) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        const prev = lines[line - 1] || ''
        const own = lines[line] || ''
        const waived = /bounds-ok:\s*\S/.test(prev) || /bounds-ok:\s*\S/.test(own)
        if (!waived && !chainIsBounded(node, sf)) {
          // Is the result assigned to a variable that gets bounded later?
          let p = node.parent
          while (p && !ts.isVariableDeclaration(p) && !ts.isBinaryExpression(p)) p = p.parent
          let name = null
          if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) name = p.name.text
          if (p && ts.isBinaryExpression(p) && ts.isIdentifier(p.left)) name = p.left.text
          const scope = boundedVars.get(enclosing(node))
          if (!name || !scope || !scope.has(name)) {
            problems.push({ file: rel, line: line + 1, text: (lines[line] || '').trim() })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
}

if (overLimit.length) {
  console.error(
    `\n${overLimit.length} read${overLimit.length === 1 ? '' : 's'} asking for more rows than ` +
    `PostgREST will ever return (server ceiling is ${MAX_ROWS}):\n`)
  for (const o of overLimit) {
    const sf2 = o.node.getSourceFile()
    const { line } = sf2.getLineAndCharacterOfPosition(o.node.getStart(sf2))
    console.error(`  ${relative(ROOT, sf2.fileName)}:${line + 1}  .${o.name}() spans ${o.span}`)
  }
  console.error(`\nUse fetchAll() to page past the ceiling, or lower the bound.\n`)
}

if (problems.length || overLimit.length) {
  console.error(
    `\nUnbounded Supabase read${problems.length === 1 ? '' : 's'} — PostgREST caps these at 1000 rows ` +
    `and nothing will tell you:\n`)
  for (const p of problems) console.error(`  ${p.file}:${p.line}\n    ${p.text}`)
  console.error(
    `\nFix by one of:\n` +
    `  countRows('table', q => q.eq(...))        when you want a number\n` +
    `  fetchAll('table',  q => q.eq(...))        when you want every row\n` +
    `  .limit(n) / .range(a, b)                  when the bound is the point\n` +
    `  // bounds-ok: <reason>                    when it genuinely cannot exceed a page\n`)
  process.exit(1)
}

console.log('bounds: every Supabase read in app/, lib/ and components/ carries an explicit bound.')

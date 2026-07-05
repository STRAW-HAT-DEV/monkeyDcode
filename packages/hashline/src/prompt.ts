/** Condensed hashline instructions for build/edit agents (omp-compatible + MDC rules). */
export const HASHLINE_EDIT_PROMPT = `## Hashline editing (preferred for existing files)

The current content of each existing target file is shown above with a
[PATH#TAG] header and numbered lines — that IS your read. Output patches in
this DSL referencing that exact TAG — NOT full-file rewrites.

Every section: \`[PATH#TAG]\` where TAG is the 4-hex snapshot shown above (required).

Operations:
- \`replace N..M:\` then body rows \`+line\` (inclusive range)
- \`delete N\` or \`delete N..M\`
- \`insert before N:\` / \`insert after N:\` / \`insert head:\` / \`insert tail:\`
- Body rows are ONLY \`+TEXT\` (verbatim). \`+\` alone = blank line. Prefix \`++\` or \`+-\` for lines starting with + or -.

Rules:
1. Line numbers refer to the ORIGINAL snapshot shown above — they do not shift between hunks in one patch.
2. Ranges must be TIGHT — only lines that change. Never retype unchanged lines in a replace body.
3. Pure additions → \`insert\`, not widened \`replace\`.
4. If a tag is reported stale, the file changed since it was shown to you — do not guess a new tag; the content shown above is out of date.

CORRECT — tight range, only the line that actually changes:
\`\`\`hashline
[src/util.ts#a1b2]
replace 2..2:
+export function add(a: number, b: number) { return a + b; }
insert after 2:
+export function sub(a: number, b: number) { return a - b; }
\`\`\`

WRONG — do not widen the range to "be safe":
\`\`\`hashline
[src/util.ts#a1b2]
replace 1..4:
+// util functions
+export function add(a: number, b: number) { return a + b; }
+export function sub(a: number, b: number) { return a - b; }
+// end
\`\`\`
This retypes lines 1, 3, and 4, which never changed — it wastes effort and
risks silently dropping content that existed between the lines you retyped.

New files (no [PATH#TAG] header shown above for them): output the complete
contents in a normal fenced code block instead — hashline only edits files
that already exist.`

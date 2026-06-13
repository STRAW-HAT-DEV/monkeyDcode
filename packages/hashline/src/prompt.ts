/** Condensed hashline instructions for build/edit agents (omp-compatible + MDC rules). */
export const HASHLINE_EDIT_PROMPT = `## Hashline editing (preferred for existing files)

After \`read\`, output patches in this DSL — NOT full-file rewrites.

Every section: \`[PATH#TAG]\` where TAG is the 4-hex snapshot from read (required).

Operations:
- \`replace N..M:\` then body rows \`+line\` (inclusive range)
- \`delete N\` or \`delete N..M\`
- \`insert before N:\` / \`insert after N:\` / \`insert head:\` / \`insert tail:\`
- Body rows are ONLY \`+TEXT\` (verbatim). \`+\` alone = blank line. Prefix \`++\` or \`+-\` for lines starting with + or -.

Rules:
1. Line numbers refer to the ORIGINAL snapshot — they do not shift between hunks in one patch.
2. Ranges must be TIGHT — only lines that change. Never retype unchanged lines in a replace body.
3. Pure additions → \`insert\`, not widened \`replace\`.
4. After every apply you get a NEW #TAG — re-read or use the edit response before the next patch.
5. On stale tag error: STOP and re-read.

Example:
\`\`\`hashline
[src/util.ts#a1b2]
replace 2..2:
+export function add(a: number, b: number) { return a + b; }
insert after 2:
+export function sub(a: number, b: number) { return a - b; }
\`\`\`

New files: use \`write\` tool. Hashline only edits existing files.`

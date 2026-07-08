`src/report.ts` and `src/invoice.ts` each have their own duplicated copy of date-formatting logic, instead of using the shared `formatDate` already defined in `src/formatDate.ts`.

Refactor both `report.ts` and `invoice.ts` to import and use `formatDate` from `src/formatDate.ts`, removing their local duplicated implementations. Observable behavior (the exact output format) must stay identical — this is a pure refactor, not a behavior change.

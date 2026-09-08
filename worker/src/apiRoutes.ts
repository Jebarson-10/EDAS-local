/**
 * Canonical API route inventory. Worker and local SQLite API must stay in parity.
 * `npm run check:routes` fails when either surface drifts.
 *
 * For dynamic routes, `matchSnippet` is a substring that must appear in both
 * handlers (copy from the `.match(/…/)` literal).
 */
export type ApiRoute =
  | { method: "GET" | "POST" | "OPTIONS" | "*"; path: string }
  | {
      method: "GET" | "POST" | "OPTIONS" | "*";
      path: string;
      matchSnippet: string;
    };

export const API_ROUTES: ApiRoute[] = [
  { method: "*", path: "/api/health" },
  { method: "*", path: "/api/me" },
  { method: "GET", path: "/api/rule-versions" },
  { method: "POST", path: "/api/rule-versions" },
  { method: "POST", path: "/api/rule-versions/activate" },
  {
    method: "GET",
    path: "/api/rule-versions/:id/parameters",
    matchSnippet: "/^\\/api\\/rule-versions\\/[^/]+\\/parameters$/",
  },
  { method: "GET", path: "/api/stats" },
  { method: "GET", path: "/api/teachers" },
  { method: "GET", path: "/api/schools" },
  { method: "GET", path: "/api/centres" },
  { method: "GET", path: "/api/blocks" },
  { method: "GET", path: "/api/subjects" },
  { method: "POST", path: "/api/master-records" },
  { method: "GET", path: "/api/relationships" },
  { method: "POST", path: "/api/relationships/clubbing" },
  { method: "GET", path: "/api/history" },
  { method: "GET", path: "/api/teacher-history/schools" },
  { method: "GET", path: "/api/teacher-history/designations" },
  { method: "GET", path: "/api/teacher-history/locations" },
  { method: "GET", path: "/api/exemptions" },
  { method: "POST", path: "/api/exemptions" },
  { method: "POST", path: "/api/imports/apply" },
  { method: "GET", path: "/api/imports" },
  { method: "POST", path: "/api/imports" },
  {
    method: "GET",
    path: "/api/imports/:id/rows",
    matchSnippet: "/^\\/api\\/imports\\/[^/]+\\/rows$/",
  },
  { method: "GET", path: "/api/manual-overrides" },
  { method: "POST", path: "/api/manual-overrides" },
  { method: "GET", path: "/api/exam-cycles" },
  { method: "POST", path: "/api/exam-cycles" },
  {
    method: "POST",
    path: "/api/exam-cycles/:id/status",
    matchSnippet: "/^\\/api\\/exam-cycles\\/[^/]+\\/status$/",
  },
  {
    method: "POST",
    path: "/api/exam-cycles/:id/window",
    matchSnippet: "/^\\/api\\/exam-cycles\\/[^/]+\\/window$/",
  },
  { method: "POST", path: "/api/centres/capacity" },
  { method: "GET", path: "/api/practical-batches" },
  { method: "POST", path: "/api/practical-batches" },
  { method: "GET", path: "/api/examiner-pairs" },
  { method: "GET", path: "/api/allocation-runs" },
  { method: "POST", path: "/api/allocation-runs" },
  {
    method: "GET",
    path: "/api/allocation-runs/:id/results",
    matchSnippet: "/^\\/api\\/allocation-runs\\/[^/]+\\/results$/",
  },
  {
    method: "GET",
    path: "/api/allocation-runs/:id/reasons",
    matchSnippet: "/^\\/api\\/allocation-runs\\/[^/]+\\/reasons$/",
  },
  {
    method: "POST",
    path: "/api/allocation-runs/:id/publish",
    matchSnippet: "/^\\/api\\/allocation-runs\\/[^/]+\\/publish$/",
  },
  { method: "GET", path: "/api/backups" },
  { method: "POST", path: "/api/backups" },
  {
    method: "GET",
    path: "/api/backups/:id",
    matchSnippet: "/^\\/api\\/backups\\/[^/]+$/",
  },
  { method: "POST", path: "/api/restore" },
  { method: "GET", path: "/api/exports" },
  { method: "POST", path: "/api/exports" },
  { method: "GET", path: "/api/audit" },
];

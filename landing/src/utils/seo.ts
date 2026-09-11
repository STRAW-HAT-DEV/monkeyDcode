import { NOINDEX_ROUTES } from "../consts.ts";

const normalize = (path: string) => `/${path.replace(/^\/+|\/+$/g, "")}`;

const excluded = new Set(NOINDEX_ROUTES.map(normalize));

export function isNoindexRoute(pathname: string): boolean {
  return excluded.has(normalize(pathname));
}

// T-295: /about for a signed-in visitor (their tier's preview cards and plan buttons). middleware.ts rewrites to here
// (lib/static-routes.ts routeFor); a direct request is a 404. Same page, rendered per request.
export { default, metadata } from "../../about/page";
export const dynamic = "force-dynamic";

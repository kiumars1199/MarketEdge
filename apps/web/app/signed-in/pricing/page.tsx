// T-295: /pricing for a signed-in visitor (their plan's buttons). middleware.ts rewrites to here
// (lib/static-routes.ts routeFor); a direct request is a 404. Same page, rendered per request.
export { default, metadata } from "../../pricing/page";
export const dynamic = "force-dynamic";

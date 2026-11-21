// T-295: /track-record for a signed-in visitor (exact curves for paid tiers). middleware.ts rewrites to here
// (lib/static-routes.ts routeFor); a direct request is a 404. Same page, rendered per request.
export { default, metadata } from "../../track-record/page";
export const dynamic = "force-dynamic";

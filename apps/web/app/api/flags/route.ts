import { listRoute } from "@/lib/data/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: Request) => listRoute(req, "flags");

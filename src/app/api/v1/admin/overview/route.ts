import { handle } from "@/lib/server/handle";
import { requireSuperAdminActor } from "@/lib/server/actor";
import { platformOverview } from "@/lib/server/admin-ops";

export async function GET() {
  return handle(async () => {
    await requireSuperAdminActor();
    return platformOverview();
  });
}

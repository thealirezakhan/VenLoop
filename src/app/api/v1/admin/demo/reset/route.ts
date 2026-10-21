import { handle } from "@/lib/server/handle";
import { requireActor } from "@/lib/server/actor";
import { demoReset } from "@/lib/server/admin-ops";

export async function POST() {
  return handle(async () => {
    const actor = await requireActor();
    return demoReset(actor);
  });
}

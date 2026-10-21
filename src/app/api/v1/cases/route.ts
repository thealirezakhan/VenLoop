import { handle } from "@/lib/server/handle";
import { requireActor } from "@/lib/server/actor";
import { listCases } from "@/lib/server/cases";

export async function GET() {
  return handle(async () => {
    const actor = await requireActor();
    return listCases(actor);
  });
}

import { handle } from "@/lib/server/handle";
import { requireActor } from "@/lib/server/actor";
import { evidenceFor } from "@/lib/server/actions";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await params;
    return evidenceFor(actor, id);
  });
}

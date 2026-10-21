import { handle } from "@/lib/server/handle";
import { requireActor } from "@/lib/server/actor";
import { acknowledgeCase } from "@/lib/server/cases";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await params;
    return acknowledgeCase(actor, id);
  });
}

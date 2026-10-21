import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/handle";
import { speechStatus } from "@/lib/server/speech";

export async function GET() {
  return handle(async () => {
    await requireActor();
    return speechStatus();
  });
}

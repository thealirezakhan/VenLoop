import { EvidenceConsole } from "@/components/evidence-console";

type Params = { params: Promise<{ id: string }> };

export default async function CheckInEvidencePage({ params }: Params) {
  const { id } = await params;
  return <EvidenceConsole id={id} backHref="/check-ins" backLabel="Check-ins" />;
}

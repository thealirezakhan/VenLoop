import { EvidenceConsole } from "@/components/evidence-console";

type Params = { params: Promise<{ id: string }> };

export default async function AdminCheckInEvidencePage({ params }: Params) {
  const { id } = await params;
  return <EvidenceConsole id={id} backHref="/admin/runs" backLabel="Test runs" />;
}


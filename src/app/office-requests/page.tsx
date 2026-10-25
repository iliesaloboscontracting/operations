import RequestsBoard from "@/components/requests/RequestsBoard";

// Directors & accounts (25 Oct 2026, Ilies): questions and actions to and
// from Nick, Yoel and accounts, kept apart from the supervisors' site requests.
export default function OfficeRequestsPage() {
  return <RequestsBoard scope="office" />;
}

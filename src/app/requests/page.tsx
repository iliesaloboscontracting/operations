import RequestsBoard from "@/components/requests/RequestsBoard";

// Site requests: what supervisors have asked for from their link (the board
// itself is shared with /office-requests).
export default function RequestsPage() {
  return <RequestsBoard scope="site" />;
}

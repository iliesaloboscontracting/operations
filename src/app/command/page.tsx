import Board from "@/components/Board";
import QuestionsBanner from "@/components/queries/QuestionsBanner";
import BinsOutCard from "@/components/bins/BinsOutCard";

export default function CommandPage() {
  return (
    <>
      <Board />
      {/* Information requests (Task I): only shows when this login has questions waiting. */}
      <QuestionsBanner floating />
      {/* Bins out (Ilies, 23 Nov 2026): a small pill on the board - Managers and Admins (the API refuses anyone else, so nothing shows). */}
      <BinsOutCard floating />
    </>
  );
}

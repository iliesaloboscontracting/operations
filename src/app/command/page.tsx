import Board from "@/components/Board";
import QuestionsBanner from "@/components/queries/QuestionsBanner";

export default function CommandPage() {
  return (
    <>
      <Board />
      {/* Information requests (Task I): only shows when this login has questions waiting. */}
      <QuestionsBanner floating />
    </>
  );
}

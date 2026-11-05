import { Board } from "@/components/board";
import { Toolbar } from "@/components/toolbar";

export default function Home() {
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <Board />
      <Toolbar />
    </main>
  );
}

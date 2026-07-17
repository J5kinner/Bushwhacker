import { isDbConfigured } from "@/db";
import { getChores } from "@/lib/queries";
import { DbNotice } from "@/components/db-notice";
import { ChoresList } from "./chores-list";

export const dynamic = "force-dynamic";

export default async function ChoresPage() {
  const chores = await getChores();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Chores</h1>
      <p className="mb-4 text-sm text-zinc-500">
        Scored by mental load, not by minutes.
      </p>
      {!isDbConfigured() && <DbNotice />}
      <ChoresList initialChores={chores} />
    </div>
  );
}

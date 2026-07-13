import Link from "next/link";
import { NewSetForm } from "./new-set-form";

export const dynamic = "force-dynamic";

/**
 * New-set page. A client form picks the mode (MANUAL / FILTER) then the
 * mode-specific fields, POSTing to /api/tutor/sets. On success the API returns
 * the new set id and the form navigates to the editor.
 */
export default function NewSetPage() {
  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <Link href="/tutor/sets" className="text-sm text-slate-500 hover:text-slate-900">
          ← Sets
        </Link>
        <h1 className="text-2xl font-bold mt-2">New puzzle set</h1>
      </div>
      <NewSetForm />
    </div>
  );
}

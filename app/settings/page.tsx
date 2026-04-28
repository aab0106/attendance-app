"use client";
import { runBulkAbsentBackfill } from "@/lib/absentBackfill";
import { useEffect, useState } from "react";
import {
  collection, getDocs, doc, updateDoc, getDoc,
  query, where, serverTimestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

interface MigrationResult {
  total: number; updated: number; alreadyCorrect: number;
  skipped: number; errors: string[];
}

export default function SettingsPage() {
  const { isAdmin, profile } = useAuth();
  const [lockedMonth, setLockedMonth]   = useState("");
  const [currentLock, setCurrentLock]   = useState<string|null>(null);
  const [lockLoading, setLockLoading]   = useState(false);
  const [migrating, setMigrating]       = useState(false);
  const [runningAbsent, setRunningAbsent]   = useState(false);
  const [absentResult, setAbsentResult]     = useState<any>(null);
  const [cleaningAbsent, setCleaningAbsent]   = useState(false);
  const [cleanupResult, setCleanupResult]     = useState<any>(null);
  const [runningBackfill, setRunningBackfill] = useState(false);
  const [backfillResult, setBackfillResult]   = useState<any>(null);
  const [backfillFrom, setBackfillFrom]       = useState("");
  const [backfillTo, setBackfillTo]           = useState("");
  const [cleaningToday, setCleaningToday]     = useState(false);
  const [cleanResult, setCleanResult]         = useState<any>(null);
  const [migResult, setMigResult]       = useState<MigrationResult|null>(null);
  const [previewData, setPreviewData]   = useState<any[]>([]);
  const [previewing, setPreviewing]     = useState(false);

  useEffect(() => { loadLock(); }, []);

  const cleanupTodayAbsent = async () => {
    if (!confirm("This will delete ALL absent records with today\'s date from Firestore. Use this only to fix stale bad data from previous buggy runs. Continue?")) return;
    setCleaningToday(true); setCleanResult(null);
    try {
      const { collection, getDocs, query, where, deleteDoc, doc } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");
      const d = new Date();
      const todayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const snap = await getDocs(query(
        collection(db,"attendance"),
        where("type","==","absent"),
        where("dateStr","==",todayStr)
      ));
      let deleted = 0;
      for (const docSnap of snap.docs) {
        await deleteDoc(doc(db,"attendance",docSnap.id));
        deleted++;
      }
      setCleanResult({ deleted, dateStr: todayStr });
    } catch(e:any) {
      setCleanResult({ error: e.message });
    } finally { setCleaningToday(false); }
  };

  const [absentInspect, setAbsentInspect] = useState<any>(null);

  const inspectAbsent = async () => {
    const { collection, getDocs, query, where } = await import("firebase/firestore");
    const { db } = await import("@/lib/firebase");
    const snap = await getDocs(query(collection(db,"attendance"), where("type","==","absent")));
    const todayStr = (() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
    const records = snap.docs.map(d => {
      const x = d.data() as any;
      let createdDate = "—";
      if (x.timestamp?.toDate) {
        const t = x.timestamp.toDate();
        createdDate = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")} ${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`;
      }
      return { id: d.id, userName: x.userName, dateStr: x.dateStr ?? "(no dateStr)", createdAt: createdDate };
    });
    setAbsentInspect({ count: records.length, records, todayStr });
  };

  const deleteAllAbsent = async () => {
    if (!confirm("⚠️ This will DELETE ALL absent records in Firestore. Are you sure?")) return;
    if (!confirm("⚠️ Second confirmation — this is irreversible. Really delete all absent records?")) return;
    const { collection, getDocs, query, where, doc, deleteDoc } = await import("firebase/firestore");
    const { db } = await import("@/lib/firebase");
    const snap = await getDocs(query(collection(db,"attendance"), where("type","==","absent")));
    let deleted = 0;
    for (const d of snap.docs) {
      await deleteDoc(doc(db,"attendance",d.id));
      deleted++;
    }
    alert(`Deleted ${deleted} absent records.`);
    setAbsentInspect(null);
  };

  const cleanStaleAbsent = async () => {
    if (!confirm("This will scan all absent records and delete:\n1. Absent records for TODAY or future\n2. Absent records with NO dateStr (corrupt data)\n3. Absent records where the same user has a punch-in OR check-in same day\n4. Duplicate absent records (same user + same date) — keeps newest\n\nContinue?")) return;
    setCleaningAbsent(true); setCleanupResult(null);
    try {
      const { collection, getDocs, query, where, doc, deleteDoc } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");
      const todayStr = (() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();

      // Get all absent records
      const absSnap = await getDocs(query(collection(db,"attendance"), where("type","==","absent")));
      const absents = absSnap.docs.map(d => ({ id:d.id, ...d.data() } as any));

      // Get all punch-ins (build punchKeys for dedup)
      const piSnap = await getDocs(query(collection(db,"attendance"), where("type","==","punch-in")));
      const punchKeys = new Set<string>();
      piSnap.docs.forEach(d => {
        const x = d.data() as any;
        let ds = x.dateStr;
        if (!ds && x.timestamp?.toDate) {
          const t = x.timestamp.toDate();
          ds = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;
        }
        if (ds) punchKeys.add(`${x.userId}_${ds}`);
      });

      // Get all check-ins (also count toward presence)
      const ciSnap = await getDocs(collection(db,"checkins"));
      ciSnap.docs.forEach(d => {
        const x = d.data() as any;
        let ds = x.dateStr;
        if (!ds && x.checkInTime?.toDate) {
          const t = x.checkInTime.toDate();
          ds = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;
        }
        if (ds) punchKeys.add(`${x.userId}_${ds}`);
      });

      let deletedToday = 0, deletedDup = 0, deletedNoDateStr = 0, deletedDuplicate = 0;
      // Track first-seen absent per userId+dateStr for dedup (keep newest)
      // Sort absents by timestamp desc — newer first
      const sorted = [...absents].sort((a,b) => {
        const tA = a.timestamp?.toDate?.()?.getTime() ?? 0;
        const tB = b.timestamp?.toDate?.()?.getTime() ?? 0;
        return tB - tA;
      });
      const seenKeys = new Set<string>();

      for (const a of sorted) {
        // 1. No dateStr → corrupt, delete
        if (!a.dateStr) {
          await deleteDoc(doc(db,"attendance",a.id));
          deletedNoDateStr++;
          continue;
        }
        // 2. Today or future → invalid, delete
        if (a.dateStr >= todayStr) {
          await deleteDoc(doc(db,"attendance",a.id));
          deletedToday++;
          continue;
        }
        const key = `${a.userId}_${a.dateStr}`;
        // 3. User has punch-in or check-in same day → conflict, delete
        if (punchKeys.has(key)) {
          await deleteDoc(doc(db,"attendance",a.id));
          deletedDup++;
          continue;
        }
        // 4. Already kept a newer absent for this user+date → duplicate, delete
        if (seenKeys.has(key)) {
          await deleteDoc(doc(db,"attendance",a.id));
          deletedDuplicate++;
          continue;
        }
        seenKeys.add(key);
      }
      setCleanupResult({ deletedToday, deletedDup, deletedNoDateStr, deletedDuplicate, scanned: absents.length });
    } catch(e:any) {
      setCleanupResult({ error: e.message });
    } finally { setCleaningAbsent(false); }
  };

  const runBackfill = async () => {
    if (!backfillFrom || !backfillTo) { alert("Select both From and To dates."); return; }
    if (!confirm(`This will mark absent for ALL employees for every working day from ${backfillFrom} to ${backfillTo} that has no attendance record. Continue?`)) return;
    setRunningBackfill(true); setBackfillResult(null);
    try {
      const res = await runBulkAbsentBackfill(backfillFrom, backfillTo);
      setBackfillResult(res);
    } catch(e:any) {
      setBackfillResult({ error: e.message });
    } finally { setRunningBackfill(false); }
  };

  const runAbsentMarkingPortal = async () => {
    if (!confirm("Run absent marking for today? This will mark all employees who haven\'t punched in as absent or field-day.")) return;
    setRunningAbsent(true); setAbsentResult(null);
    try {
      // Call the same logic via Firestore directly
      const today = new Date();
      const dateStr = today.toISOString().split("T")[0];
      const hour = today.getHours();
      if (hour < 18 && !confirm("It\'s before 6PM. Run anyway for testing?")) {
        setRunningAbsent(false); return;
      }
      // Import and run
      const res = await fetch("/api/run-absent", { method: "POST" }).catch(() => null);
      // If no API route, show instructions
      setAbsentResult({ manual: true, dateStr });
    } catch(e: any) { alert(e.message); }
    finally { setRunningAbsent(false); }
  };

  const loadLock = async () => {
    try {
      const snap = await getDoc(doc(db,"settings","monthLock"));
      if (snap.exists()) setCurrentLock(snap.data().lockedMonth ?? null);
    } catch {}
  };

  const handleLock = async () => {
    if (!lockedMonth) return;
    if (!confirm(`Lock month ${lockedMonth}? Managers cannot edit records from this month or earlier.`)) return;
    setLockLoading(true);
    try {
      await updateDoc(doc(db,"settings","monthLock"), {
        lockedMonth, lockedBy: profile?.name??"Admin", lockedAt: serverTimestamp()
      });
      setCurrentLock(lockedMonth); setLockedMonth("");
    } catch(e:any) { alert(e.message); }
    finally { setLockLoading(false); }
  };

  const handleUnlock = async () => {
    if (!confirm("Remove month lock? Managers will be able to edit all records again.")) return;
    setLockLoading(true);
    try {
      await updateDoc(doc(db,"settings","monthLock"), {
        lockedMonth: null, unlockedBy: profile?.name??"Admin", unlockedAt: serverTimestamp()
      });
      setCurrentLock(null);
    } catch(e:any) { alert(e.message); }
    finally { setLockLoading(false); }
  };

  // ── Migration: fix department name strings → doc IDs ──────────────────────
  const previewMigration = async () => {
    setPreviewing(true);
    try {
      const [deptSnap, userSnap] = await Promise.all([
        getDocs(query(collection(db,"departments"), where("active","==",true))),
        getDocs(collection(db,"users")),
      ]);

      // Build maps: name→id and id→name
      const nameToId = new Map<string,string>();
      const idSet    = new Set<string>();
      deptSnap.docs.forEach(d => {
        const name = (d.data().name ?? "").toLowerCase().trim();
        nameToId.set(name, d.id);
        idSet.add(d.id);
      });

      const toFix: any[] = [];
      userSnap.docs.forEach(d => {
        const data = d.data();
        const dept = data.department;
        if (!dept) return; // no dept set — skip
        if (idSet.has(dept)) return; // already a valid doc ID — skip

        // It's a text name — try to find matching dept
        const matchId = nameToId.get(dept.toLowerCase().trim());
        toFix.push({
          id: d.id,
          name: data.name ?? data.email,
          currentDept: dept,
          newDeptId:   matchId ?? null,
          newDeptName: matchId
            ? deptSnap.docs.find(x=>x.id===matchId)?.data().name
            : "⚠️ No match found",
          canFix: !!matchId,
        });
      });
      setPreviewData(toFix);
    } finally { setPreviewing(false); }
  };

  const runMigration = async () => {
    if (!previewData.length) return;
    const fixable = previewData.filter(u => u.canFix);
    if (!fixable.length) { alert("No users to fix."); return; }
    if (!confirm(`Update ${fixable.length} user(s) with correct department IDs?`)) return;

    setMigrating(true);
    const result: MigrationResult = { total: previewData.length, updated:0, alreadyCorrect:0, skipped:0, errors:[] };
    try {
      await Promise.all(fixable.map(async u => {
        try {
          await updateDoc(doc(db,"users",u.id), {
            department: u.newDeptId,
            departmentMigratedAt: serverTimestamp(),
          });
          result.updated++;
        } catch(e:any) {
          result.errors.push(`${u.name}: ${e.message}`);
        }
      }));
      result.skipped = previewData.filter(u => !u.canFix).length;
      setMigResult(result);
      setPreviewData([]); // clear preview after run
    } finally { setMigrating(false); }
  };

  if (!isAdmin) return <div className="p-8 text-center text-gray-400">Admin access required.</div>;

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">System configuration and maintenance tools</p>
      </div>

      {/* ── Month Lock ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">Payroll Month Lock</h2>
        <p className="text-sm text-gray-500 mb-4">Lock a month to prevent managers from editing attendance records.</p>
        {currentLock && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
            <span className="text-red-600 text-xl">🔒</span>
            <div className="flex-1">
              <p className="text-sm font-bold text-red-700">Locked: {currentLock} and earlier</p>
              <p className="text-xs text-red-500">Managers cannot edit records from this period</p>
            </div>
            <button onClick={handleUnlock} disabled={lockLoading}
              className="text-xs bg-red-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-red-700">
              Remove Lock
            </button>
          </div>
        )}
        <div className="flex gap-3 items-end">
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Lock month</label>
            <input type="month" value={lockedMonth} onChange={e=>setLockedMonth(e.target.value)}
              className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={handleLock} disabled={!lockedMonth||lockLoading}
            className="bg-red-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-700 disabled:bg-gray-300">
            {lockLoading ? "Saving..." : "Set Lock"}
          </button>
        </div>
      </div>

      {/* ── Run Absent Marking ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">Run Absent Marking</h2>
        <p className="text-sm text-gray-500 mb-4">
          Marks all employees who have not punched in today as absent or field-day.
          Normally run after 6PM daily. On mobile: Admin screen → Run Absent Marking.
        </p>
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4 text-sm text-amber-700">
          <p className="font-semibold mb-1">⚠️ Portal trigger not yet available</p>
          <p>Absent marking must currently be run from the <strong>mobile app</strong> → Admin screen → Run Absent Marking button (after 6PM).</p>
          <p className="mt-1">Cloud Functions (auto-trigger at 6PM daily) will be added when upgrading to Firebase Blaze plan.</p>
        </div>
        <div className="text-sm text-gray-500">
          <p className="font-semibold text-gray-700 mb-1">What it does:</p>
          <p>1. Fetches all active employees (approved device OR joining date set)</p>
          <p>2. Skips blocked users, non-working days, holidays</p>
          <p>3. Employees with check-ins → Field Day (pending manager approval)</p>
          <p>4. Employees with no activity → Absent</p>
        </div>
      </div>

      {/* ── Cleanup Today's Absent Records ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">🧹 Cleanup Today's Absent Records</h2>
        <p className="text-sm text-gray-500 mb-4">
          One-time fix: deletes all absent records with today's date. Use this if previous buggy absent marking runs wrote today's date into Firestore. Safe — only removes absent records for the current date.
        </p>
        <div className="flex gap-3 items-center">
          <button onClick={cleanupTodayAbsent} disabled={cleaningToday}
            className="bg-red-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-700 disabled:bg-gray-300">
            {cleaningToday ? "Cleaning..." : "Delete today\'s absent records"}
          </button>
          {cleanResult && (
            <div className={`text-sm font-semibold ${cleanResult.error?"text-red-600":"text-green-600"}`}>
              {cleanResult.error ? `Error: ${cleanResult.error}` : `✓ Deleted ${cleanResult.deleted} absent record(s) for ${cleanResult.dateStr}`}
            </div>
          )}
        </div>
      </div>

      {/* ── Inspect Absent Records ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">Inspect Absent Records</h2>
        <p className="text-sm text-gray-500 mb-4">
          Shows every absent record in Firestore with its dateStr and creation time.
          Use this to see what the buggy runs actually wrote.
        </p>
        <div className="flex gap-3">
          <button onClick={inspectAbsent} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">
            🔍 Inspect All Absent Records
          </button>
          <button onClick={deleteAllAbsent} className="bg-red-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-700">
            ⚠️ Delete ALL Absent Records
          </button>
        </div>
        {absentInspect && (
          <div className="mt-4 bg-gray-50 rounded-xl p-4 text-xs max-h-96 overflow-y-auto">
            <p className="font-bold mb-2">Found {absentInspect.count} absent records. Today = {absentInspect.todayStr}</p>
            <table className="w-full">
              <thead><tr className="text-left text-gray-600 border-b"><th className="pb-2">Employee</th><th>Date (dateStr)</th><th>Created At</th></tr></thead>
              <tbody>
                {absentInspect.records.map((r:any)=>(
                  <tr key={r.id} className={`border-b border-gray-200 ${r.dateStr===absentInspect.todayStr?"bg-red-100":""}`}>
                    <td className="py-1">{r.userName}</td>
                    <td className={r.dateStr===absentInspect.todayStr?"text-red-700 font-bold":""}>{r.dateStr}</td>
                    <td className="text-gray-500">{r.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Clean Stale Absent Records ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">Clean Stale Absent Records</h2>
        <p className="text-sm text-gray-500 mb-4">
          Deletes absent records that shouldn't exist: (1) any absent record for today (ongoing day),
          and (2) any absent record where the same user also has a punch-in on the same day.
          Use this to fix bad data from earlier buggy runs.
        </p>
        <button onClick={cleanStaleAbsent} disabled={cleaningAbsent}
          className="bg-red-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-700 disabled:bg-gray-300">
          {cleaningAbsent ? "Cleaning..." : "🗑️ Clean Stale Absent Records"}
        </button>
        {cleanupResult && (
          <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${cleanupResult.error?"bg-red-50 text-red-700":"bg-green-50 text-green-700"}`}>
            {cleanupResult.error ? `Error: ${cleanupResult.error}` :
              <div>
                <p className="font-semibold mb-1">✓ Cleanup done — scanned {cleanupResult.scanned} absent records:</p>
                <ul className="text-xs space-y-0.5 ml-4 list-disc">
                  <li>{cleanupResult.deletedToday} deleted for today/future date</li>
                  <li>{cleanupResult.deletedNoDateStr} deleted with no dateStr (corrupt)</li>
                  <li>{cleanupResult.deletedDup} deleted (user had punch-in/check-in same day)</li>
                  <li>{cleanupResult.deletedDuplicate} deleted (duplicate of newer absent record)</li>
                </ul>
              </div>}
          </div>
        )}
      </div>

      {/* ── Bulk Absent Back-fill ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">Bulk Absent Back-fill</h2>
        <p className="text-sm text-gray-500 mb-4">
          Mark absent for all employees across a date range — for days with no attendance record.
          Use this to fix historical data. Skips weekends, holidays, and days that already have records.
        </p>
        <div className="flex gap-3 mb-4 flex-wrap items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">From Date</label>
            <input type="date" value={backfillFrom} onChange={e=>setBackfillFrom(e.target.value)}
              className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">To Date</label>
            <input type="date" value={backfillTo} onChange={e=>setBackfillTo(e.target.value)}
              className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          </div>
          <button onClick={runBackfill} disabled={runningBackfill||!backfillFrom||!backfillTo}
            className="bg-orange-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-orange-700 disabled:bg-gray-300">
            {runningBackfill ? "Running..." : "Run Back-fill"}
          </button>
        </div>
        {backfillResult && (
          <div className={`rounded-xl px-4 py-3 text-sm ${backfillResult.error?"bg-red-50 text-red-700":"bg-green-50 text-green-700"}`}>
            {backfillResult.error ? `Error: ${backfillResult.error}` :
              `✓ Done — ${backfillResult.totalMarked} absent records created, ${backfillResult.totalSkipped} days already had records, ${backfillResult.datesProcessed} dates processed.`}
          </div>
        )}
      </div>

      {/* ── Department Migration Tool ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">Fix Department Assignments</h2>
        <p className="text-sm text-gray-500 mb-2">
          Old users may have department stored as a text name (e.g. "IT") instead of the correct
          Firestore document ID. This breaks the manager team view. Run this tool to detect and fix them.
        </p>
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4 text-xs text-blue-700">
          ℹ️ This is safe to run multiple times — it only updates users whose department is a text string,
          not a valid department ID. Users already correctly assigned are untouched.
        </div>

        <div className="flex gap-3 mb-5">
          <button onClick={previewMigration} disabled={previewing}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300">
            {previewing ? "Scanning..." : "1. Scan for issues"}
          </button>
          {previewData.length > 0 && (
            <button onClick={runMigration} disabled={migrating || !previewData.some(u=>u.canFix)}
              className="bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700 disabled:bg-gray-300">
              {migrating ? "Fixing..." : `2. Fix ${previewData.filter(u=>u.canFix).length} user(s)`}
            </button>
          )}
        </div>

        {/* Preview results */}
        {previewData.length > 0 && (
          <div className="border border-gray-100 rounded-xl overflow-hidden mb-4">
            <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-700">
                Found {previewData.length} user(s) with text department names
                · {previewData.filter(u=>u.canFix).length} can be auto-fixed
                · {previewData.filter(u=>!u.canFix).length} need manual assignment
              </p>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                {["Employee","Current (wrong)","Will become","Status"].map(h=>(
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {previewData.map((u,i)=>(
                  <tr key={u.id} className={`border-b border-gray-50 ${i%2===0?"":"bg-gray-50/50"}`}>
                    <td className="px-4 py-2.5 font-semibold text-gray-800">{u.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-red-600">{u.currentDept}</td>
                    <td className="px-4 py-2.5 text-sm text-green-700 font-medium">{u.newDeptName}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${u.canFix?"bg-green-100 text-green-700":"bg-red-100 text-red-600"}`}>
                        {u.canFix ? "✓ Auto-fixable" : "⚠ Manual needed"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {previewData.length === 0 && !previewing && migResult === null && (
          <div className="text-center py-8 text-gray-400">
            <p className="text-3xl mb-2">🔍</p>
            <p className="text-sm">Click "Scan for issues" to check all users</p>
          </div>
        )}

        {/* Migration result */}
        {migResult && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="font-bold text-green-700 mb-2">✅ Migration complete</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                {l:"Updated",v:migResult.updated,c:"text-green-700"},
                {l:"Skipped (no match)",v:migResult.skipped,c:"text-amber-600"},
                {l:"Errors",v:migResult.errors.length,c:"text-red-600"},
              ].map(s=>(
                <div key={s.l} className="bg-white rounded-lg p-3">
                  <p className={`text-2xl font-bold ${s.c}`}>{s.v}</p>
                  <p className="text-xs text-gray-500">{s.l}</p>
                </div>
              ))}
            </div>
            {migResult.errors.length > 0 && (
              <div className="mt-3">
                {migResult.errors.map((e,i)=><p key={i} className="text-xs text-red-600">{e}</p>)}
              </div>
            )}
            <p className="text-xs text-green-600 mt-3">
              Managers should now see their team members correctly. Ask managers to log out and back in.
            </p>
          </div>
        )}
      </div>

      {/* ── System Info ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-4">System Information</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          {[
            ["Portal Version",    "v1.1.0"],
            ["Mobile App",        "v1.0.2 (beta)"],
            ["Database",          "Firebase Firestore"],
            ["Auth",              "Firebase Auth"],
            ["Last Schema Update","April 2026"],
            ["Cloud Functions",   "Planned (Blaze plan)"],
          ].map(([l,v])=>(
            <div key={l} className="flex justify-between py-2 border-b border-gray-50">
              <span className="text-gray-500">{l}</span>
              <span className="font-semibold text-gray-700">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

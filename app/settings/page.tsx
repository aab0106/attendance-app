"use client";
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
  const [migResult, setMigResult]       = useState<MigrationResult|null>(null);
  const [previewData, setPreviewData]   = useState<any[]>([]);
  const [previewing, setPreviewing]     = useState(false);

  useEffect(() => { loadLock(); }, []);

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

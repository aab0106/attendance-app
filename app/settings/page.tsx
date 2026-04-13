"use client";
import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

export default function SettingsPage() {
  const { isAdmin, profile } = useAuth();
  const [lockedMonth, setLockedMonth]   = useState<string|null>(null);
  const [lockedBy, setLockedBy]         = useState<string|null>(null);
  const [monthInput, setMonthInput]     = useState("");
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [msg, setMsg]                   = useState("");

  useEffect(() => { loadLock(); }, []);

  const loadLock = async () => {
    setLoading(true);
    try {
      const snap = await getDoc(doc(db,"settings","monthLock"));
      if (snap.exists()) {
        const d = snap.data();
        setLockedMonth(d.lockedMonth ?? null);
        setLockedBy(d.lockedBy ?? null);
      }
    } finally { setLoading(false); }
  };

  const handleLock = async () => {
    if (!monthInput.match(/^\d{4}-\d{2}$/)) { setMsg("Enter month in YYYY-MM format e.g. 2026-03"); return; }
    setSaving(true); setMsg("");
    try {
      await setDoc(doc(db,"settings","monthLock"), { lockedMonth:monthInput, lockedBy:profile?.name??profile?.email, lockedAt:serverTimestamp() }, { merge:true });
      setLockedMonth(monthInput); setLockedBy(profile?.name??profile?.email??null); setMonthInput("");
      setMsg(`Month ${monthInput} locked successfully.`);
    } catch(e:any) { setMsg(e.message); } finally { setSaving(false); }
  };

  const handleUnlock = async () => {
    if (!confirm("Unlock the current month? Managers will be able to make edits again.")) return;
    setSaving(true);
    try {
      await setDoc(doc(db,"settings","monthLock"), { lockedMonth:null, unlockedBy:profile?.name??profile?.email, unlockedAt:serverTimestamp() }, { merge:true });
      setLockedMonth(null); setLockedBy(null); setMsg("Month unlocked.");
    } catch(e:any) { setMsg(e.message); } finally { setSaving(false); }
  };

  if (!isAdmin) return <div className="p-8 text-center text-gray-400">Admin access required.</div>;

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Settings</h1>
      <p className="text-gray-500 text-sm mb-8">System configuration and payroll controls</p>

      {/* Month Lock */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-5">
        <h2 className="text-base font-bold text-gray-800 mb-1">Payroll Month Lock</h2>
        <p className="text-sm text-gray-500 mb-5">Lock a month to prevent managers from editing attendance records after payroll is processed. Admins can still edit anytime.</p>

        {loading ? <div className="text-gray-400 text-sm">Loading...</div> : (
          <>
            {lockedMonth ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-amber-800">🔒 {lockedMonth} and earlier are locked</p>
                    {lockedBy && <p className="text-xs text-amber-600 mt-0.5">Locked by {lockedBy}</p>}
                  </div>
                  <button onClick={handleUnlock} disabled={saving}
                    className="bg-amber-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-amber-700 disabled:bg-amber-300">
                    Unlock
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
                <p className="text-sm text-green-700 font-medium">✅ No month is currently locked. Managers can edit all records.</p>
              </div>
            )}

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Lock Month (YYYY-MM)</label>
                <input type="month" value={monthInput} onChange={e=>setMonthInput(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex items-end">
                <button onClick={handleLock} disabled={saving||!monthInput}
                  className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300">
                  {saving?"Locking...":"Lock Month"}
                </button>
              </div>
            </div>
            {msg && <p className={`text-sm mt-3 font-medium ${msg.includes("success")||msg.includes("unlocked")?"text-green-600":"text-red-600"}`}>{msg}</p>}
          </>
        )}
      </div>

      {/* Info */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-3">System Info</h2>
        <div className="space-y-2">
          {[["Portal Version","1.0.2"],["Mobile App Version","1.0.2"],["Database","Firebase Firestore"],["Auth","Firebase Auth (shared with mobile app)"],["Hosting","Vercel (planned)"]].map(([k,v])=>(
            <div key={k} className="flex justify-between py-2 border-b border-gray-50 last:border-0">
              <span className="text-sm text-gray-500">{k}</span>
              <span className="text-sm font-semibold text-gray-700">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

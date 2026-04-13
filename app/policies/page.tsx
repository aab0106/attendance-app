"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, addDoc, updateDoc, doc, query, where, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Modal from "@/components/ui/Modal";

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DEPARTMENTS = ["Sales","Marketing","IT","Accounts","Construction","Admin","CEO Staff","Plot Trading"];

interface Policy {
  id:string; name:string; workStartTime:string; workEndTime:string;
  graceMinutes:number; workDays:number[]; overtimeAfterMins:number;
  leaveTypes:{casual:number;sick:number;annual:number};
  appliesToAll:boolean; departmentIds:string[]; active:boolean;
}

const DEFAULT_FORM = {
  name:"", workStartTime:"10:00", workEndTime:"18:00", graceMinutes:30,
  workDays:[1,2,3,4,5] as number[], overtimeAfterMins:30,
  casual:10, sick:8, annual:14, appliesToAll:false, departmentIds:[] as string[],
};

export default function PoliciesPage() {
  const { isAdmin, user } = useAuth();
  const [policies, setPolicies]   = useState<Policy[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editTarget, setEditTarget] = useState<Policy|null>(null);
  const [form, setForm]           = useState(DEFAULT_FORM);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db,"policies"), where("active","==",true)));
      setPolicies(snap.docs.map(d=>({id:d.id,...d.data()} as Policy)));
    } finally { setLoading(false); }
  };

  const openCreate = () => {
    setForm(DEFAULT_FORM); setEditTarget(null); setError(""); setShowForm(true);
  };

  const openEdit = (p:Policy) => {
    setForm({
      name:p.name, workStartTime:p.workStartTime, workEndTime:p.workEndTime,
      graceMinutes:p.graceMinutes, workDays:p.workDays??[1,2,3,4,5],
      overtimeAfterMins:p.overtimeAfterMins??30,
      casual:p.leaveTypes?.casual??10, sick:p.leaveTypes?.sick??8, annual:p.leaveTypes?.annual??14,
      appliesToAll:p.appliesToAll, departmentIds:p.departmentIds??[],
    });
    setEditTarget(p); setError(""); setShowForm(true);
  };

  const toggleDay = (d:number) => setForm(f => ({
    ...f, workDays: f.workDays.includes(d) ? f.workDays.filter(x=>x!==d) : [...f.workDays, d].sort((a,b)=>a-b)
  }));

  const toggleDept = (d:string) => setForm(f => ({
    ...f, departmentIds: f.departmentIds.includes(d) ? f.departmentIds.filter(x=>x!==d) : [...f.departmentIds, d]
  }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Policy name is required."); return; }
    if (!form.workDays.length) { setError("Select at least one working day."); return; }
    if (!form.appliesToAll && !form.departmentIds.length) { setError("Select at least one department or set to all."); return; }
    setSaving(true); setError("");
    try {
      const data = {
        name: form.name.trim(),
        workStartTime: form.workStartTime,
        workEndTime: form.workEndTime,
        graceMinutes: Number(form.graceMinutes),
        workDays: form.workDays,
        overtimeAfterMins: Number(form.overtimeAfterMins),
        leaveTypes: { casual:Number(form.casual), sick:Number(form.sick), annual:Number(form.annual) },
        appliesToAll: form.appliesToAll,
        departmentIds: form.appliesToAll ? [] : form.departmentIds,
        active: true,
      };
      if (editTarget) {
        await updateDoc(doc(db,"policies",editTarget.id), { ...data, updatedAt:serverTimestamp() });
      } else {
        await addDoc(collection(db,"policies"), { ...data, createdBy:user?.uid, createdAt:serverTimestamp() });
      }
      setShowForm(false); loadData();
    } catch(e:any) { setError(e.message); } finally { setSaving(false); }
  };

  const handleDeactivate = async (p:Policy) => {
    if (!confirm(`Deactivate "${p.name}"? It will no longer apply to employees.`)) return;
    await updateDoc(doc(db,"policies",p.id), { active:false });
    loadData();
  };

  if (!isAdmin) return <div className="p-8 text-center text-gray-400">Admin access required.</div>;

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Work Policies</h1>
          <p className="text-gray-500 text-sm mt-1">{policies.length} active policies</p>
        </div>
        <button onClick={openCreate} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">+ New Policy</button>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-6 flex gap-3">
        <span>ℹ️</span>
        <div className="text-sm text-blue-700">
          <p className="font-semibold mb-1">How policies work</p>
          <p>Each policy defines work hours, grace period, working days, and leave entitlement for a group of departments. When an employee punches in, the system finds their department's policy and uses it to calculate if they are late. Absent marking also uses the work days to skip non-working days automatically.</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">{[1,2].map(i=><div key={i} className="bg-white rounded-2xl border border-gray-100 h-40 animate-pulse"/>)}</div>
      ) : policies.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-5xl mb-3">📜</p>
          <p className="font-medium mb-1">No policies yet</p>
          <p className="text-xs">Create your first policy or click New Policy to add the default Construction and Office policies.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {policies.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-base font-bold text-gray-800">{p.name}</h2>
                <div className="flex gap-2">
                  <button onClick={()=>openEdit(p)} className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100 font-semibold">Edit</button>
                  <button onClick={()=>handleDeactivate(p)} className="text-xs bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 font-semibold">Deactivate</button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                  ["Work Hours", `${p.workStartTime} – ${p.workEndTime}`],
                  ["Grace Period", `${p.graceMinutes} min`],
                  ["Overtime after", `${p.overtimeAfterMins??30} min past end`],
                  ["Applies to", p.appliesToAll?"All departments":`${(p.departmentIds??[]).length} dept(s)`],
                ].map(([l,v])=>(
                  <div key={l} className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs font-bold text-gray-400 uppercase mb-1">{l}</p>
                    <p className="text-sm font-bold text-gray-800">{v}</p>
                  </div>
                ))}
              </div>
              <div className="mb-3">
                <p className="text-xs font-bold text-gray-400 uppercase mb-2">Work Days</p>
                <div className="flex gap-1.5">
                  {DAYS.map((d,i)=>(
                    <span key={d} className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ${(p.workDays??[]).includes(i)?"bg-blue-600 text-white":"bg-gray-100 text-gray-400"}`}>{d}</span>
                  ))}
                </div>
              </div>
              {p.leaveTypes && (
                <div className="flex gap-2 mb-3">
                  {[["Casual",p.leaveTypes.casual],["Sick",p.leaveTypes.sick],["Annual",p.leaveTypes.annual]].map(([l,v])=>(
                    <div key={l} className="bg-blue-50 rounded-lg px-3 py-2 text-center">
                      <p className="text-xs text-blue-400 font-semibold">{l}</p>
                      <p className="text-sm font-bold text-blue-700">{v} days/yr</p>
                    </div>
                  ))}
                </div>
              )}
              {!p.appliesToAll && (p.departmentIds??[]).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(p.departmentIds??[]).map(d=><span key={d} className="text-xs bg-gray-100 text-gray-600 font-medium px-2 py-1 rounded-lg">{d}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Policy Form Modal */}
      {showForm && (
        <Modal title={editTarget ? "Edit Policy" : "New Policy"} onClose={() => setShowForm(false)} maxWidth="max-w-2xl">
          <div className="p-6 space-y-5">
            {/* Name */}
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-1.5">Policy Name *</label>
              <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Construction Site Policy"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {/* Hours */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Work Start *</label>
                <input type="time" value={form.workStartTime} onChange={e=>setForm(f=>({...f,workStartTime:e.target.value}))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Work End *</label>
                <input type="time" value={form.workEndTime} onChange={e=>setForm(f=>({...f,workEndTime:e.target.value}))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Grace Period (min)</label>
                <input type="number" min={0} max={120} value={form.graceMinutes} onChange={e=>setForm(f=>({...f,graceMinutes:parseInt(e.target.value)||0}))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {/* Overtime */}
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-1.5">Overtime starts after (minutes past end time)</label>
              <input type="number" min={0} max={120} value={form.overtimeAfterMins} onChange={e=>setForm(f=>({...f,overtimeAfterMins:parseInt(e.target.value)||0}))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {/* Work Days */}
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-2">Working Days *</label>
              <div className="flex gap-2">
                {DAYS.map((d,i)=>(
                  <button key={d} type="button" onClick={()=>toggleDay(i)}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${form.workDays.includes(i)?"bg-blue-600 text-white border-blue-600":"border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Leave Types */}
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-2">Leave Entitlement (days per year)</label>
              <div className="grid grid-cols-3 gap-3">
                {[["Casual","casual"],["Sick","sick"],["Annual","annual"]].map(([l,k])=>(
                  <div key={k}>
                    <label className="block text-xs text-gray-500 mb-1">{l} Leave</label>
                    <input type="number" min={0} max={365} value={(form as any)[k]} onChange={e=>setForm(f=>({...f,[k]:parseInt(e.target.value)||0}))}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                ))}
              </div>
            </div>

            {/* Applies To */}
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-2">Applies To</label>
              <div className="flex gap-3 mb-3">
                {[true,false].map(v=>(
                  <button key={String(v)} type="button" onClick={()=>setForm(f=>({...f,appliesToAll:v}))}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${form.appliesToAll===v?"bg-blue-600 text-white border-blue-600":"border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                    {v?"All departments":"Specific departments"}
                  </button>
                ))}
              </div>
              {!form.appliesToAll && (
                <div className="flex flex-wrap gap-2">
                  {DEPARTMENTS.map(d=>(
                    <button key={d} type="button" onClick={()=>toggleDept(d)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${form.departmentIds.includes(d)?"bg-blue-600 text-white border-blue-600":"border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                      {d}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {error && <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3 pt-2">
              <button onClick={()=>setShowForm(false)} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300">
                {saving?"Saving...":editTarget?"Update Policy":"Create Policy"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

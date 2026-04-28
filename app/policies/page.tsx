"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, addDoc, updateDoc, doc, query, where, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

interface Policy {
  id:string; name:string; policyType:"office"|"field";
  // Office fields
  workStartTime:string; workEndTime:string;
  graceMinutes:number; overtimeAfterMins:number; earlyGoingMins:number; gapCreditMins:number;
  // Field fields
  minDailyHours:number; maxGapMins:number; travelTimeCredit:boolean; flexibleStart:boolean;
  // Common
  workDays:number[]; leaveTypes:{casual:number;sick:number;annual:number;medical:number;unpaid:number};
  appliesToAll:boolean; departmentIds:string[]; active:boolean;
}

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const DEFAULT_OFFICE = {
  policyType:"office" as const, name:"",
  workStartTime:"10:00", workEndTime:"18:00",
  graceMinutes:30, overtimeAfterMins:30, earlyGoingMins:10, gapCreditMins:15,
  minDailyHours:6, maxGapMins:60, travelTimeCredit:true, flexibleStart:true,
  workDays:[1,2,3,4,5] as number[],
  casual:10, sick:8, annual:14, medical:6, unpaid:0,
  appliesToAll:false, departmentIds:[] as string[],
};

const DEFAULT_FIELD = {
  policyType:"field" as const, name:"",
  workStartTime:"09:00", workEndTime:"18:00",
  graceMinutes:0, overtimeAfterMins:0, earlyGoingMins:0, gapCreditMins:60,
  minDailyHours:6, maxGapMins:60, travelTimeCredit:true, flexibleStart:true,
  workDays:[1,2,3,4,5] as number[],
  casual:10, sick:8, annual:14, medical:6, unpaid:0,
  appliesToAll:false, departmentIds:[] as string[],
};

export default function PoliciesPage() {
  const { isAdmin, user } = useAuth();
  const [policies, setPolicies]     = useState<Policy[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Policy|null>(null);
  const [form, setForm]             = useState<any>(DEFAULT_OFFICE);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");
  const [depts, setDepts]           = useState<{id:string;name:string}[]>([]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pSnap, dSnap] = await Promise.all([
        getDocs(query(collection(db,"policies"), where("active","==",true))),
        getDocs(query(collection(db,"departments"), where("active","==",true))),
      ]);
      setPolicies(pSnap.docs.map(d=>({id:d.id,...d.data()} as Policy)));
      setDepts(dSnap.docs.map(d=>({id:d.id,name:(d.data() as any).name})));
    } finally { setLoading(false); }
  };

  const openCreate = (type: "office"|"field") => {
    setForm(type === "office" ? {...DEFAULT_OFFICE} : {...DEFAULT_FIELD});
    setEditTarget(null); setError(""); setShowForm(true); setShowTypeModal(false);
  };

  const openEdit = (p:Policy) => {
    setForm({
      policyType: p.policyType ?? "office",
      name: p.name,
      workStartTime: p.workStartTime ?? "10:00",
      workEndTime: p.workEndTime ?? "18:00",
      graceMinutes: p.graceMinutes ?? 30,
      overtimeAfterMins: p.overtimeAfterMins ?? 30,
      earlyGoingMins: p.earlyGoingMins ?? 10,
      gapCreditMins: p.gapCreditMins ?? 15,
      minDailyHours: p.minDailyHours ?? 6,
      maxGapMins: p.maxGapMins ?? 60,
      travelTimeCredit: p.travelTimeCredit ?? true,
      flexibleStart: p.flexibleStart ?? true,
      workDays: p.workDays ?? [1,2,3,4,5],
      casual: p.leaveTypes?.casual ?? 10,
      sick: p.leaveTypes?.sick ?? 8,
      annual: p.leaveTypes?.annual ?? 14,
      medical: p.leaveTypes?.medical ?? 6,
      unpaid: p.leaveTypes?.unpaid ?? 0,
      appliesToAll: p.appliesToAll,
      departmentIds: p.departmentIds ?? [],
    });
    setEditTarget(p); setError(""); setShowForm(true);
  };

  const toggleDay = (d:number) => setForm((f:any) => ({
    ...f, workDays: f.workDays.includes(d) ? f.workDays.filter((x:number)=>x!==d) : [...f.workDays, d].sort((a:number,b:number)=>a-b)
  }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Policy name is required."); return; }
    if (!form.workDays.length) { setError("Select at least one working day."); return; }
    if (!form.appliesToAll && !form.departmentIds.length) { setError("Select at least one department or set to all."); return; }
    setSaving(true); setError("");
    try {
      const data: any = {
        policyType: form.policyType,
        name: form.name.trim(),
        workDays: form.workDays,
        leaveTypes: { casual:Number(form.casual), sick:Number(form.sick), annual:Number(form.annual), medical:Number(form.medical??6), unpaid:Number(form.unpaid??0) },
        appliesToAll: form.appliesToAll,
        departmentIds: form.appliesToAll ? [] : form.departmentIds,
        active: true,
      };
      if (form.policyType === "office") {
        data.workStartTime    = form.workStartTime;
        data.workEndTime      = form.workEndTime;
        data.graceMinutes     = Number(form.graceMinutes);
        data.overtimeAfterMins = Number(form.overtimeAfterMins);
        data.earlyGoingMins   = Number(form.earlyGoingMins ?? 10);
        data.gapCreditMins    = Number(form.gapCreditMins ?? 15);
      } else {
        data.minDailyHours    = Number(form.minDailyHours ?? 6);
        data.maxGapMins       = Number(form.maxGapMins ?? 60);
        data.travelTimeCredit = Boolean(form.travelTimeCredit);
        data.flexibleStart    = Boolean(form.flexibleStart);
        data.workStartTime    = form.workStartTime; // earliest expected start (informational)
        data.gapCreditMins    = Number(form.maxGapMins ?? 60); // reuse for compatibility
      }
      if (editTarget) {
        await updateDoc(doc(db,"policies",editTarget.id), { ...data, updatedAt:serverTimestamp() });
      } else {
        await addDoc(collection(db,"policies"), { ...data, createdBy:user?.uid, createdAt:serverTimestamp() });
      }
      setShowForm(false); loadData();
    } catch(e:any) { setError(e.message); } finally { setSaving(false); }
  };

  const handleDeactivate = async (p:Policy) => {
    if (!confirm(`Deactivate "${p.name}"?`)) return;
    await updateDoc(doc(db,"policies",p.id), { active:false });
    loadData();
  };

  if (!isAdmin) return <div className="p-8 text-center text-gray-400">Admin access required.</div>;

  const isField = form.policyType === "field";

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Work Policies</h1>
          <p className="text-gray-500 text-sm mt-1">{policies.length} active policies</p>
        </div>
        <button onClick={()=>setShowTypeModal(true)} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">
          + Add Policy
        </button>
      </div>

      {/* Policy Type Selection Modal */}
      {showTypeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e=>{if(e.target===e.currentTarget) setShowTypeModal(false);}}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">What type of policy?</h3>
            <p className="text-sm text-gray-500 mb-6">Choose the policy type that matches the employee's work style.</p>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={()=>openCreate("office")} className="border-2 border-blue-200 hover:border-blue-500 hover:bg-blue-50 rounded-2xl p-5 text-left transition-colors group">
                <div className="text-3xl mb-3">🏢</div>
                <p className="font-bold text-gray-900 group-hover:text-blue-700">Office Policy</p>
                <p className="text-xs text-gray-500 mt-1">Fixed start/end time, grace period, overtime tracking. For employees who work at a fixed location.</p>
              </button>
              <button onClick={()=>openCreate("field")} className="border-2 border-green-200 hover:border-green-500 hover:bg-green-50 rounded-2xl p-5 text-left transition-colors group">
                <div className="text-3xl mb-3">🚗</div>
                <p className="font-bold text-gray-900 group-hover:text-green-700">Field Staff Policy</p>
                <p className="text-xs text-gray-500 mt-1">Travel time credited, flexible start, measured by total hours vs daily target. For riders, field agents.</p>
              </button>
            </div>
            <button onClick={()=>setShowTypeModal(false)} className="mt-4 w-full border border-gray-200 text-gray-500 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Policy List */}
      {loading ? (
        <div className="grid gap-4">{[1,2].map(i=><div key={i} className="bg-white rounded-2xl border h-32 animate-pulse"/>)}</div>
      ) : policies.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-sm">No policies yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {policies.map(p => {
            const isFieldP = p.policyType === "field";
            return (
              <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{isFieldP ? "🚗" : "🏢"}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-gray-900 text-lg">{p.name}</h3>
                        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${isFieldP ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                          {isFieldP ? "Field Staff" : "Office"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {p.appliesToAll ? "All departments" : `${(p.departmentIds??[]).length} dept(s)`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={()=>openEdit(p)} className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 font-semibold text-gray-600">Edit</button>
                    <button onClick={()=>handleDeactivate(p)} className="text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 font-semibold">Deactivate</button>
                  </div>
                </div>

                {/* Policy details */}
                <div className="grid grid-cols-3 gap-3 text-xs mb-4">
                  {isFieldP ? (
                    <>
                      <div className="bg-green-50 rounded-xl p-3"><p className="text-green-400 font-semibold uppercase mb-1">Min Daily Hrs</p><p className="font-bold text-green-800">{p.minDailyHours ?? 6}h</p></div>
                      <div className="bg-green-50 rounded-xl p-3"><p className="text-green-400 font-semibold uppercase mb-1">Max Travel Gap</p><p className="font-bold text-green-800">{p.maxGapMins ?? 60} min</p></div>
                      <div className="bg-green-50 rounded-xl p-3"><p className="text-green-400 font-semibold uppercase mb-1">Travel Credited</p><p className="font-bold text-green-800">{p.travelTimeCredit ? "Yes ✓" : "No"}</p></div>
                      <div className="bg-green-50 rounded-xl p-3"><p className="text-green-400 font-semibold uppercase mb-1">Earliest Start</p><p className="font-bold text-green-800">{p.workStartTime}</p></div>
                      <div className="bg-green-50 rounded-xl p-3"><p className="text-green-400 font-semibold uppercase mb-1">Flexible Start</p><p className="font-bold text-green-800">{p.flexibleStart ? "Yes" : "No"}</p></div>
                      <div className="bg-green-50 rounded-xl p-3"><p className="text-green-400 font-semibold uppercase mb-1">No Late Penalty</p><p className="font-bold text-green-800">✓</p></div>
                    </>
                  ) : (
                    <>
                      <div className="bg-blue-50 rounded-xl p-3"><p className="text-blue-400 font-semibold uppercase mb-1">Work Hours</p><p className="font-bold text-blue-800">{p.workStartTime} – {p.workEndTime}</p></div>
                      <div className="bg-blue-50 rounded-xl p-3"><p className="text-blue-400 font-semibold uppercase mb-1">Grace Period</p><p className="font-bold text-blue-800">{p.graceMinutes} min</p></div>
                      <div className="bg-blue-50 rounded-xl p-3"><p className="text-blue-400 font-semibold uppercase mb-1">Overtime After</p><p className="font-bold text-blue-800">{p.overtimeAfterMins ?? 30} min past end</p></div>
                      <div className="bg-blue-50 rounded-xl p-3"><p className="text-blue-400 font-semibold uppercase mb-1">Early Going</p><p className="font-bold text-blue-800">{p.earlyGoingMins ?? 10} min buffer</p></div>
                      <div className="bg-blue-50 rounded-xl p-3"><p className="text-blue-400 font-semibold uppercase mb-1">Gap Credit</p><p className="font-bold text-blue-800">{p.gapCreditMins ?? 15} min</p></div>
                    </>
                  )}
                </div>

                {/* Work days */}
                <div className="flex gap-1.5 mb-4">
                  {DAYS.map((d,i)=>(
                    <span key={d} className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ${(p.workDays??[]).includes(i)?"bg-blue-600 text-white":"bg-gray-100 text-gray-400"}`}>{d}</span>
                  ))}
                </div>

                {/* Leave types */}
                {p.leaveTypes && (
                  <div className="flex gap-2 flex-wrap">
                    {[["Casual",p.leaveTypes.casual],["Sick",p.leaveTypes.sick],["Annual",p.leaveTypes.annual],["Medical",p.leaveTypes.medical??6],["Unpaid",p.leaveTypes.unpaid??0]].map(([l,v])=>(
                      <div key={l as string} className="bg-gray-50 rounded-lg px-3 py-1.5 text-center border border-gray-100">
                        <p className="text-xs text-gray-400 font-semibold">{l as string}</p>
                        <p className="text-sm font-bold text-gray-700">{v} days/yr</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 overflow-y-auto" onClick={e=>{if(e.target===e.currentTarget) setShowForm(false);}}>
          <div className="flex min-h-full items-start justify-center p-4 py-8">
          <div className="bg-white rounded-2xl p-6 w-full max-w-xl shadow-xl">
            <div className="flex items-center gap-3 mb-6">
              <span className="text-2xl">{isField ? "🚗" : "🏢"}</span>
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  {editTarget ? "Edit" : "Create"} {isField ? "Field Staff" : "Office"} Policy
                </h3>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isField ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                  {isField ? "Field Staff" : "Office"}
                </span>
              </div>
            </div>

            <div className="space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Policy Name *</label>
                <input value={form.name} onChange={e=>setForm((f:any)=>({...f,name:e.target.value}))} placeholder={isField ? "e.g. Bank Riders Policy" : "e.g. Standard Office Policy"}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              </div>

              {/* Office-specific fields */}
              {!isField && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1.5">Work Start Time</label>
                      <input type="time" value={form.workStartTime} onChange={e=>setForm((f:any)=>({...f,workStartTime:e.target.value}))}
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1.5">Work End Time</label>
                      <input type="time" value={form.workEndTime} onChange={e=>setForm((f:any)=>({...f,workEndTime:e.target.value}))}
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1.5">Grace Period (min)</label>
                      <input type="number" min={0} max={120} value={form.graceMinutes} onChange={e=>setForm((f:any)=>({...f,graceMinutes:parseInt(e.target.value)||0}))}
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1.5">Overtime After (min past end)</label>
                      <input type="number" min={0} max={120} value={form.overtimeAfterMins} onChange={e=>setForm((f:any)=>({...f,overtimeAfterMins:parseInt(e.target.value)||0}))}
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1.5">Early Going (min before end)</label>
                      <input type="number" min={0} max={120} value={form.earlyGoingMins??10} onChange={e=>setForm((f:any)=>({...f,earlyGoingMins:parseInt(e.target.value)||0}))}
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                      <p className="text-xs text-gray-400 mt-1">0 = disabled</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1.5">Gap Credit (min between sessions)</label>
                      <input type="number" min={0} max={120} value={form.gapCreditMins??15} onChange={e=>setForm((f:any)=>({...f,gapCreditMins:parseInt(e.target.value)||0}))}
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                    </div>
                  </div>
                </>
              )}

              {/* Field-specific fields */}
              {isField && (
                <>
                  <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                    <p className="text-xs font-semibold text-green-700 mb-3">ℹ️ Field staff: travel time between check-ins is credited. No fixed start time. Measured by total daily hours vs target.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1.5">Min Daily Hours</label>
                      <input type="number" min={1} max={12} step={0.5} value={form.minDailyHours??6} onChange={e=>setForm((f:any)=>({...f,minDailyHours:parseFloat(e.target.value)||6}))}
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                      <p className="text-xs text-gray-400 mt-1">Target hours per working day</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1.5">Max Travel Gap (min)</label>
                      <input type="number" min={5} max={180} value={form.maxGapMins??60} onChange={e=>setForm((f:any)=>({...f,maxGapMins:parseInt(e.target.value)||60}))}
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                      <p className="text-xs text-gray-400 mt-1">Gaps under this = credited as work</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-1.5">Earliest Expected Start (informational)</label>
                    <input type="time" value={form.workStartTime} onChange={e=>setForm((f:any)=>({...f,workStartTime:e.target.value}))}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                    <p className="text-xs text-gray-400 mt-1">No penalty for arriving later — used for scheduling reference only</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="checkbox" id="travelCredit" checked={!!form.travelTimeCredit} onChange={e=>setForm((f:any)=>({...f,travelTimeCredit:e.target.checked}))} className="w-4 h-4 accent-green-600"/>
                    <label htmlFor="travelCredit" className="text-sm font-semibold text-gray-700">Credit travel time between check-ins (under max gap)</label>
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="checkbox" id="flexStart" checked={!!form.flexibleStart} onChange={e=>setForm((f:any)=>({...f,flexibleStart:e.target.checked}))} className="w-4 h-4 accent-green-600"/>
                    <label htmlFor="flexStart" className="text-sm font-semibold text-gray-700">Flexible start time (no late arrival penalty)</label>
                  </div>
                </>
              )}

              {/* Work Days — common */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-2">Working Days *</label>
                <div className="flex gap-2">
                  {DAYS.map((d,i)=>(
                    <button key={d} type="button" onClick={()=>toggleDay(i)}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${form.workDays.includes(i)?"bg-blue-600 text-white border-blue-600":"border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Leave Entitlement — common */}
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">📋</span>
                  <label className="text-sm font-bold text-gray-700">Leave Entitlement (days/year)</label>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[["Casual","casual"],["Sick","sick"],["Annual","annual"],["Medical","medical"],["Unpaid","unpaid"]].map(([l,k])=>(
                    <div key={k}>
                      <label className="block text-xs text-gray-500 mb-1">{l} Leave</label>
                      <input type="number" min={0} max={365} value={(form as any)[k]} onChange={e=>setForm((f:any)=>({...f,[k]:parseInt(e.target.value)||0}))}
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                    </div>
                  ))}
                </div>
              </div>

              {/* Applies To — common */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-2">Applies To *</label>
                <div className="flex gap-3 mb-3">
                  {[true,false].map(v=>(
                    <button key={String(v)} type="button" onClick={()=>setForm((f:any)=>({...f,appliesToAll:v}))}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${form.appliesToAll===v?"bg-blue-600 text-white border-blue-600":"border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                      {v ? "All Employees" : "Specific Departments"}
                    </button>
                  ))}
                </div>
                {!form.appliesToAll && (
                  <div className="grid grid-cols-2 gap-2">
                    {depts.map(d=>(
                      <button key={d.id} type="button" onClick={()=>setForm((f:any)=>({...f, departmentIds: f.departmentIds.includes(d.id) ? f.departmentIds.filter((x:string)=>x!==d.id) : [...f.departmentIds, d.id]}))}
                        className={`px-3 py-2 rounded-xl text-xs font-semibold border text-left transition-colors ${form.departmentIds.includes(d.id)?"bg-blue-50 border-blue-300 text-blue-700":"border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                        {d.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {error && <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button onClick={()=>setShowForm(false)} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300">
                  {saving ? "Saving..." : editTarget ? "Update Policy" : "Create Policy"}
                </button>
              </div>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

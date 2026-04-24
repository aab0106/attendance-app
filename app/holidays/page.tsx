"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, addDoc, updateDoc, doc, query, where, serverTimestamp, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Modal from "@/components/ui/Modal";

const DEPARTMENTS = ["Sales","Marketing","IT","Accounts","Construction","Admin","CEO Staff","Plot Trading"];

interface Holiday { id:string; name:string; type:string; dates:string[]; appliesToAll:boolean; departmentIds:string[]; active:boolean; }
interface UserRecord { id:string; name?:string; email:string; department?:string; }
interface Notification { id:string; title:string; body:string; fromName?:string; toUserId?:string; timestamp?:any; type?:string; }

const getDatesInRange = (from: string, to: string): string[] => {
  const dates: string[] = [];
  const start = new Date(from + "T00:00:00");
  const end   = new Date(to   + "T00:00:00");
  if (start > end) return [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
};

const fmtDate = (dateStr:string) => {
  try { return new Date(dateStr + "T00:00:00").toLocaleDateString([], {weekday:"short",month:"short",day:"numeric",year:"numeric"}); }
  catch { return dateStr; }
};
const fmtTs = (ts:any) => {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
};

export default function HolidaysPage() {
  const { isAdmin, user, profile } = useAuth();
  const [tab, setTab]             = useState<"holidays"|"notifications">("holidays");

  // Holiday state
  const [holidays, setHolidays]   = useState<Holiday[]>([]);
  const [allUsers, setAllUsers]   = useState<UserRecord[]>([]);
  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [hName, setHName]         = useState("");
  const [hType, setHType]         = useState("public");
  const [hDateFrom, setHDateFrom] = useState("");
  const [hDateTo, setHDateTo]     = useState("");
  const [hInstructions, setHInstr] = useState("");
  const [hAll, setHAll]           = useState(true);
  const [hDepts, setHDepts]       = useState<string[]>([]);
  const [hNotify, setHNotify]     = useState(true);
  const [hSaving, setHSaving]     = useState(false);
  const [hError, setHError]       = useState("");

  // Notification state
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifForm, setShowNotifForm] = useState(false);
  const [nTitle, setNTitle]       = useState("");
  const [nBody, setNBody]         = useState("");
  const [nAll, setNAll]           = useState(true);
  const [nDepts, setNDepts]       = useState<string[]>([]);
  const [nSaving, setNSaving]     = useState(false);
  const [nError, setNError]       = useState("");

  const [loading, setLoading]     = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [hSnap, uSnap, nSnap] = await Promise.all([
        getDocs(query(collection(db,"holidays"), where("active","==",true))),
        getDocs(collection(db,"users")),
        getDocs(query(collection(db,"notifications"), where("fromUserId","==",user?.uid ?? ""))),
      ]);
      setHolidays(hSnap.docs.map(d=>({id:d.id,...d.data()} as Holiday)).sort((a,b)=>(a.dates[0]??"").localeCompare(b.dates[0]??"")));
      setAllUsers(uSnap.docs.map(d=>({id:d.id,...d.data()} as UserRecord)));
      setNotifications(nSnap.docs.map(d=>({id:d.id,...d.data()} as Notification)).sort((a,b)=>{
        const ta = a.timestamp?.toDate?.()?.getTime() ?? 0;
        const tb = b.timestamp?.toDate?.()?.getTime() ?? 0;
        return tb - ta;
      }));
    } finally { setLoading(false); }
  };

  const toggleHDept = (d:string) => setHDepts(p=>p.includes(d)?p.filter(x=>x!==d):[...p,d]);
  const toggleNDept = (d:string) => setNDepts(p=>p.includes(d)?p.filter(x=>x!==d):[...p,d]);

  // ── Save Holiday ──────────────────────────────────────────────────────────
  const handleSaveHoliday = async () => {
    if (!hName.trim()) { setHError("Holiday name is required."); return; }
    if (!hDateFrom) { setHError("From date is required."); return; }
    if (!hDateTo)   { setHError("To date is required."); return; }
    if (hDateFrom > hDateTo) { setHError("From date must be before or equal to To date."); return; }
    const dates = getDatesInRange(hDateFrom, hDateTo);
    if (!dates.length) { setHError("No valid dates in selected range."); return; }
    if (!hAll && !hDepts.length) { setHError("Select at least one department."); return; }
    setHSaving(true); setHError("");
    try {
      const ref = await addDoc(collection(db,"holidays"), {
        name:hName.trim(), type:hType, dates, appliesToAll:hAll,
        departmentIds:hAll?[]:hDepts, instructions:hInstructions.trim()||null,
        active:true, createdBy:user?.uid, createdAt:serverTimestamp(),
      });
      if (hNotify) {
        const targets = hAll ? allUsers : allUsers.filter(u=>u.department&&hDepts.includes(u.department));
        const datesStr = dates.map(d=>fmtDate(d)).join(", ");
        const body = `${dates.length>1?`${dates.length}-day holiday`:"Holiday"} on ${datesStr}${hInstructions.trim()?`. ${hInstructions.trim()}`:"."}`;
        await Promise.all(targets.map(u=>addDoc(collection(db,"notifications"),{
          fromUserId:user?.uid??null, fromName:profile?.name??"Admin",
          toUserId:u.id, title:`🏖️ Holiday: ${hName.trim()}`, body,
          type:"holiday", holidayId:ref.id, read:false, timestamp:serverTimestamp(),
        })));
      }
      setHName(""); setHDateFrom(""); setHDateTo(""); setHInstr(""); setHDepts([]); setHAll(true); setShowHolidayForm(false);
      loadData();
    } catch(e:any) { setHError(e.message); } finally { setHSaving(false); }
  };

  // ── Send Notification ─────────────────────────────────────────────────────
  const handleSendNotification = async () => {
    if (!nTitle.trim()) { setNError("Title is required."); return; }
    if (!nBody.trim())  { setNError("Message is required."); return; }
    if (!nAll && !nDepts.length) { setNError("Select at least one department or send to all."); return; }
    setNSaving(true); setNError("");
    try {
      const targets = nAll ? allUsers : allUsers.filter(u=>u.department&&nDepts.includes(u.department));
      await Promise.all(targets.map(u=>addDoc(collection(db,"notifications"),{
        fromUserId:user?.uid??null, fromName:profile?.name??"Admin",
        toUserId:u.id, title:nTitle.trim(), body:nBody.trim(),
        type:"announcement", read:false, timestamp:serverTimestamp(),
      })));
      setNTitle(""); setNBody(""); setNDepts([]); setNAll(true); setShowNotifForm(false);
      loadData();
    } catch(e:any) { setNError(e.message); } finally { setNSaving(false); }
  };

  if (!isAdmin) return <div className="p-8 text-center text-gray-400">Admin access required.</div>;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Holidays & Notifications</h1>
          <p className="text-gray-500 text-sm mt-1">Manage holidays and send announcements to employees</p>
        </div>
        <div className="flex gap-2">
          {tab === "holidays" && (
            <button onClick={() => setShowHolidayForm(true)}
              className="bg-amber-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-600">
              + Add Holiday
            </button>
          )}
          {tab === "notifications" && (
            <button onClick={() => setShowNotifForm(true)}
              className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">
              + Send Notification
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab("holidays")}
          className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${tab==="holidays"?"bg-amber-500 text-white":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
          🏖️ Holidays ({holidays.length})
        </button>
        <button onClick={() => setTab("notifications")}
          className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${tab==="notifications"?"bg-blue-600 text-white":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
          🔔 Sent Notifications ({Object.keys(notifications.reduce((g:any,n:any)=>{const k=n.broadcastId??n.id;if(!g[k])g[k]=1;return g;},{})).length})
        </button>
      </div>

      {/* ── HOLIDAYS TAB ── */}
      {tab === "holidays" && (
        <>
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-5 flex gap-3">
            <span>ℹ️</span>
            <p className="text-sm text-amber-700">
              Holidays are automatically respected during absent marking. If an employee's department has a holiday on a given date, they will not be marked absent. Employees receive an in-app notification when a holiday is added.
            </p>
          </div>

          {loading ? (
            <div className="space-y-3">{[1,2,3].map(i=><div key={i} className="bg-white rounded-2xl border h-20 animate-pulse"/>)}</div>
          ) : holidays.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-5xl mb-3">🏖️</p>
              <p className="font-medium">No holidays added yet</p>
              <p className="text-xs mt-1">Add public and company holidays — absent marking will skip them automatically</p>
            </div>
          ) : (
            <div className="space-y-3">
              {holidays.map(h => (
                <div key={h.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-3 flex-1">
                      <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-xl flex-shrink-0">🏖️</div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-bold text-gray-800">{h.name}</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${h.type==="public"?"bg-blue-100 text-blue-700":"bg-purple-100 text-purple-700"}`}>{h.type}</span>
                        </div>
                        <p className="text-sm text-amber-700 font-medium mb-1">
                          {h.dates.map(d=>fmtDate(d)).join(" · ")}
                        </p>
                        <p className="text-xs text-gray-400">
                          {h.appliesToAll?"All departments":(h.departmentIds??[]).join(", ")} · {h.dates.length} day{h.dates.length!==1?"s":""}
                        </p>
                      </div>
                    </div>
                    <button onClick={async()=>{ if(!confirm(`Remove "${h.name}"?`))return; await updateDoc(doc(db,"holidays",h.id),{active:false}); loadData(); }}
                      className="bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-red-100 flex-shrink-0">
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── NOTIFICATIONS TAB ── */}
      {tab === "notifications" && (
        <>
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-5 flex gap-3">
            <span>ℹ️</span>
            <p className="text-sm text-blue-700">
              Send important announcements to all employees or specific departments. These appear as in-app notifications on the mobile app. Employees can tap to read the full message.
            </p>
          </div>

          {loading ? (
            <div className="space-y-3">{[1,2,3].map(i=><div key={i} className="bg-white rounded-2xl border h-16 animate-pulse"/>)}</div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-5xl mb-3">🔔</p>
              <p className="font-medium">No notifications sent yet</p>
              <p className="text-xs mt-1">Send an announcement to all employees or specific departments</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.values(notifications.reduce((groups:any, n:any) => {
                // Group by broadcastId (new) OR by title+date (old records without broadcastId)
                const dateKey = n.timestamp?.toDate
                  ? n.timestamp.toDate().toISOString().slice(0,13) // group by title+hour
                  : "unknown";
                const key = n.broadcastId ?? (n.title + "_" + dateKey);
                if (!groups[key]) groups[key] = {...n, _count: 0};
                groups[key]._count++;
                return groups;
              }, {})).map((n:any) => (
                <div key={n.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex gap-3">
                  <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center text-lg flex-shrink-0">
                    {n.type==="holiday"?"🏖️":"📢"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-800">{n.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-xs text-gray-300 mt-1">{fmtTs(n.timestamp)} · Sent to {n.recipientCount ?? n._count ?? 1} employee{(n.recipientCount??n._count??1)!==1?"s":""}</p>
                  </div>
                </div>
              ))}
              <p className="text-xs text-gray-400 text-center pt-2">Each row = one announcement. Showing unique broadcasts sent by you.</p>
            </div>
          )}
        </>
      )}

      {/* ── ADD HOLIDAY MODAL ── */}
      {showHolidayForm && (
        <Modal title="Add Holiday" onClose={()=>{setShowHolidayForm(false);setHError("");}} maxWidth="max-w-xl">
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Holiday Name *</label>
                <input value={hName} onChange={e=>setHName(e.target.value)} placeholder="e.g. Eid ul Fitr"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Type</label>
                <select value={hType} onChange={e=>setHType(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                  <option value="public">Public Holiday</option>
                  <option value="company">Company Holiday</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Applies to</label>
                <select value={String(hAll)} onChange={e=>setHAll(e.target.value==="true")}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                  <option value="true">All departments</option>
                  <option value="false">Specific departments</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">From Date *</label>
                <input type="date" value={hDateFrom} onChange={e=>setHDateFrom(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">To Date *</label>
                <input type="date" value={hDateTo} onChange={e=>setHDateTo(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div className="col-span-2 bg-amber-50 rounded-xl px-3 py-2">
                <p className="text-xs text-amber-700 font-medium">
                  {hDateFrom && hDateTo && hDateFrom <= hDateTo
                    ? `${getDatesInRange(hDateFrom, hDateTo).length} day(s): ${getDatesInRange(hDateFrom, hDateTo).map(d=>fmtDate(d)).join(", ")}`
                    : "Select from and to dates"}
                </p>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Instructions for employees (optional)</label>
                <textarea value={hInstructions} onChange={e=>setHInstr(e.target.value)} rows={2}
                  placeholder="e.g. Office will remain closed. Emergency: 0300-0000000"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
              </div>
            </div>
            {!hAll && (
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-2">Select Departments *</label>
                <div className="flex flex-wrap gap-2">
                  {DEPARTMENTS.map(d=>(
                    <button key={d} type="button" onClick={()=>toggleHDept(d)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${hDepts.includes(d)?"bg-amber-500 text-white border-amber-500":"border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
              <input type="checkbox" id="hNotify" checked={hNotify} onChange={e=>setHNotify(e.target.checked)} className="w-4 h-4 rounded" />
              <label htmlFor="hNotify" className="text-sm font-medium text-green-700 cursor-pointer">
                Send in-app notification to affected employees
              </label>
            </div>
            {hError && <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{hError}</p>}
            <div className="flex gap-3 pt-2">
              <button onClick={()=>{setShowHolidayForm(false);setHError("");}} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50">Cancel</button>
              <button onClick={handleSaveHoliday} disabled={hSaving} className="flex-1 bg-amber-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-amber-600 disabled:bg-amber-300">
                {hSaving?"Saving...":"Save Holiday"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── SEND NOTIFICATION MODAL ── */}
      {showNotifForm && (
        <Modal title="Send Notification" onClose={()=>{setShowNotifForm(false);setNError("");}} maxWidth="max-w-lg">
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-1.5">Title *</label>
              <input value={nTitle} onChange={e=>setNTitle(e.target.value)} placeholder="e.g. Office closed tomorrow"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-1.5">Message *</label>
              <textarea value={nBody} onChange={e=>setNBody(e.target.value)} rows={4}
                placeholder="Write your announcement here. This will be the full message employees see when they tap the notification."
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              <p className="text-xs text-gray-400 mt-1">{nBody.length} characters — long messages will have a "Read more" option on mobile</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-2">Send to</label>
              <div className="flex gap-3 mb-3">
                {[true,false].map(v=>(
                  <button key={String(v)} type="button" onClick={()=>setNAll(v)}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${nAll===v?"bg-blue-600 text-white border-blue-600":"border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                    {v?"All employees":"Specific departments"}
                  </button>
                ))}
              </div>
              {!nAll && (
                <div className="flex flex-wrap gap-2">
                  {DEPARTMENTS.map(d=>(
                    <button key={d} type="button" onClick={()=>toggleNDept(d)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${nDepts.includes(d)?"bg-blue-600 text-white border-blue-600":"border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                      {d}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-400 mt-2">
                {nAll ? `Will send to all ${allUsers.length} employees` : `Will send to ${allUsers.filter(u=>u.department&&nDepts.includes(u.department)).length} employees in selected departments`}
              </p>
            </div>
            {nError && <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{nError}</p>}
            <div className="flex gap-3 pt-2">
              <button onClick={()=>{setShowNotifForm(false);setNError("");}} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50">Cancel</button>
              <button onClick={handleSendNotification} disabled={nSaving} className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300">
                {nSaving?`Sending to ${nAll?allUsers.length:allUsers.filter(u=>u.department&&nDepts.includes(u.department)).length} employees...`:"Send Notification"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

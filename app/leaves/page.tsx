"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where, doc, updateDoc, serverTimestamp, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { getTeamMembersForManager, getDirectorMembers } from "@/lib/team-utils";

interface Leave {
  id:string; userId:string; userName:string; department?:string;
  leaveType:string; leaveLabel?:string; fromDate:string; toDate:string;
  days:number; reason:string; status:string;
  managerStatus?:string; managerNote?:string; reviewedByManager?:string;
  hrStatus?:string; hrNote?:string; reviewedByHR?:string;
  timestamp?:any;
}

const fmtDate = (s:string) => s ? new Date(s+"T00:00:00").toLocaleDateString([],{day:"numeric",month:"short",year:"numeric"}) : "—";
const fmtTs   = (ts:any) => { if(!ts) return "—"; const d=ts.toDate?ts.toDate():new Date(ts); return d.toLocaleDateString([],{day:"numeric",month:"short",year:"numeric"}); };

const statusBadge = (s:string) => {
  if(s==="pending_manager") return "bg-amber-100 text-amber-700";
  if(s==="pending_hr")      return "bg-blue-100 text-blue-700";
  if(s==="approved")        return "bg-green-100 text-green-700";
  if(s==="rejected")        return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-600";
};
const statusLabel = (s:string) => ({
  pending_manager:"Pending manager", pending_hr:"Pending HR",
  approved:"Approved", rejected:"Rejected"
}[s] ?? s);

export default function LeavesPage() {
  const { isAdmin, isDirector, isManager, user, profile } = useAuth();
  const isHR = Array.isArray((profile as any)?.role)
    ? (profile as any).role.includes("hr")
    : (profile as any)?.role === "hr";

  const [leaves, setLeaves]     = useState<Leave[]>([]);
  const [loading, setLoading]   = useState(true);
  const [depts, setDepts]       = useState<{id:string;name:string}[]>([]);
  const [users, setUsers]       = useState<Map<string,any>>(new Map());
  const [filterStatus, setFilterStatus] = useState("all");
  const [actionLeave, setActionLeave]   = useState<Leave|null>(null);
  const [actionType, setActionType]     = useState<"approve"|"reject">("approve");
  const [actionNote, setActionNote]     = useState("");
  const [submitting, setSubmitting]     = useState(false);
  const [scopedIds, setScopedIds]       = useState<Set<string>|null>(null);

  useEffect(()=>{
    Promise.all([
      getDocs(query(collection(db,"departments"),where("active","==",true))),
      getDocs(collection(db,"users")),
    ]).then(([dSnap,uSnap])=>{
      setDepts(dSnap.docs.map(d=>({id:d.id,name:(d.data() as any).name})));
      const m=new Map(); uSnap.docs.forEach(d=>m.set(d.id,d.data())); setUsers(m);
    });
  },[]);

  useEffect(()=>{
    if(!user) return;
    if(isAdmin||isHR){setScopedIds(null);return;}
    const load=async()=>{
      const members=isDirector?await getDirectorMembers(user.uid,db):await getTeamMembersForManager(user.uid,db);
      setScopedIds(new Set(members.map((m:any)=>m.id)));
    };
    load();
  },[user,isAdmin,isDirector,isHR]);

  useEffect(()=>{ loadLeaves(); },[scopedIds]);

  const loadLeaves = async () => {
    if(!user) return;
    setLoading(true);
    try {
      let q;
      // All roles see all leaves — HR acts on pending_hr, others see their scope
      q = query(collection(db,"leaves"), orderBy("timestamp","desc"));
      const snap = await getDocs(q);
      let all = snap.docs.map(d=>({id:d.id,...d.data()} as Leave));
      if(!isAdmin && !isHR && scopedIds) all = all.filter(l=>scopedIds.has(l.userId));
      setLeaves(all);
    } finally { setLoading(false); }
  };

  const handleAction = async () => {
    if(!actionLeave||!user) return;
    setSubmitting(true);
    try {
      const approved = actionType==="approve";
      const reviewerName = (profile as any)?.name ?? user.email;
      // Determine which stage to act on
      // - HR (not admin): always acts as HR
      // - Manager: always acts as manager
      // - Admin: acts based on current status (pending_hr → HR action, pending_manager → manager action)
      const actAsHR = isHR || (isAdmin && actionLeave.status === "pending_hr");
      if(actAsHR) {
        await updateDoc(doc(db,"leaves",actionLeave.id),{
          hrStatus: approved?"approved":"rejected",
          hrNote: actionNote||null, reviewedByHR:reviewerName,
          hrReviewedAt:serverTimestamp(), status:approved?"approved":"rejected",
        });
      } else {
        await updateDoc(doc(db,"leaves",actionLeave.id),{
          managerStatus: approved?"approved":"rejected",
          managerNote: actionNote||null, reviewedByManager:reviewerName,
          managerReviewedAt:serverTimestamp(), status:approved?"pending_hr":"rejected",
        });
      }
      setActionLeave(null); setActionNote("");
      loadLeaves();
    } catch(e:any){ alert(e.message); }
    finally{ setSubmitting(false); }
  };

  const canAct = (l:Leave) => {
    if(l.status==="approved" || l.status==="rejected") return false; // never re-action finished leaves
    if(isAdmin) return true;
    if(isHR && !isAdmin) return l.status==="pending_hr";
    return l.status==="pending_manager";
  };

  const filtered = leaves.filter(l => filterStatus==="all" || l.status===filterStatus);
  const counts = {
    all: leaves.length,
    pending_manager: leaves.filter(l=>l.status==="pending_manager").length,
    pending_hr:      leaves.filter(l=>l.status==="pending_hr").length,
    approved:        leaves.filter(l=>l.status==="approved").length,
    rejected:        leaves.filter(l=>l.status==="rejected").length,
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leave Requests</h1>
          <p className="text-gray-500 text-sm mt-1">
            {isAdmin?"All employees":isHR?"All leave requests (HR view)":isDirector?"Your departments":"Your team"}
          </p>
        </div>
        <button onClick={loadLeaves} className="border border-gray-200 text-gray-600 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-gray-50">
          Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {([["all","All"],["pending_manager","Pending manager"],["pending_hr","Pending HR"],["approved","Approved"],["rejected","Rejected"]] as [string,string][]).map(([v,l])=>(
          <button key={v} onClick={()=>setFilterStatus(v)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${filterStatus===v?"bg-blue-600 text-white":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            {l} ({counts[v as keyof typeof counts]??0})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-3">{[1,2,3].map(i=><div key={i} className="bg-white rounded-2xl border h-24 animate-pulse"/>)}</div>
      ) : filtered.length===0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-sm">No leave requests found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(l=>{
            const deptName = depts.find(d=>d.id===l.department)?.name ?? l.department ?? "—";
            const typeLabel = l.leaveLabel ?? l.leaveType;
            return (
              <div key={l.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="font-bold text-gray-900">{l.userName}</p>
                      <span className="text-xs text-gray-400">{deptName}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge(l.status)}`}>
                        {statusLabel(l.status)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      <span className="font-semibold">{typeLabel}</span>
                      {"  ·  "}{fmtDate(l.fromDate)} → {fmtDate(l.toDate)}
                      {"  ·  "}<span className="font-semibold">{l.days}</span> day{l.days!==1?"s":""}
                    </p>
                    {l.reason && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{l.reason}</p>}
                    {/* Approval trail */}
                    <div className="flex gap-4 mt-2 flex-wrap">
                      {l.managerStatus && (
                        <p className="text-xs text-gray-400">
                          Manager: <span className={`font-semibold ${l.managerStatus==="approved"?"text-green-600":"text-red-600"}`}>{l.managerStatus}</span>
                          {l.reviewedByManager?` · ${l.reviewedByManager}`:""}
                          {l.managerNote?` — "${l.managerNote}"`:""}
                        </p>
                      )}
                      {l.hrStatus && (
                        <p className="text-xs text-gray-400">
                          HR: <span className={`font-semibold ${l.hrStatus==="approved"?"text-green-600":"text-red-600"}`}>{l.hrStatus}</span>
                          {l.reviewedByHR?` · ${l.reviewedByHR}`:""}
                          {l.hrNote?` — "${l.hrNote}"`:""}
                        </p>
                      )}
                    </div>
                  </div>
                  {canAct(l) && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={()=>{setActionLeave(l);setActionType("approve");setActionNote("");}}
                        className="bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-green-700">
                        Approve
                      </button>
                      <button onClick={()=>{setActionLeave(l);setActionType("reject");setActionNote("");}}
                        className="bg-red-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-red-700">
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action modal */}
      {actionLeave && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-gray-900 mb-1">
              {actionType==="approve"?"Approve Leave":"Reject Leave"}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {actionLeave.userName} · {actionLeave.leaveLabel ?? actionLeave.leaveType} · {actionLeave.days} days
            </p>
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Note (optional)</label>
            <textarea value={actionNote} onChange={e=>setActionNote(e.target.value)} rows={3}
              placeholder="Add a note for the employee..."
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-4"/>
            <div className="flex gap-3">
              <button onClick={()=>setActionLeave(null)}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleAction} disabled={submitting}
                className={`flex-1 text-white py-2.5 rounded-xl text-sm font-semibold disabled:bg-gray-300 ${actionType==="approve"?"bg-green-600 hover:bg-green-700":"bg-red-600 hover:bg-red-700"}`}>
                {submitting?"Saving...":(actionType==="approve"?"Approve":"Reject")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Modal from "@/components/ui/Modal";

interface AttRecord {
  id:string; userId:string; userName:string; type:string; status:string;
  punchInTime?:any; punchOutTime?:any; durationMinutes?:number;
  lateStatus?:string; lateMinutes?:number; lateApproved?:boolean|null;
  lateReason?:string; reviewReason?:string; dateStr?:string; timestamp?:any;
  fieldDaySummary?:string; autoClosedAt?:any; closedBy?:string;
}
interface CheckIn {
  id:string; userId:string; userName:string; subType:string;
  checkInTime?:any; checkOutTime?:any; durationMinutes?:number;
  status:string; clientName?:string; siteName?:string; dateStr?:string;
  closedBy?:string; managerMinutes?:number;
}
interface Policy {
  id:string; name:string; workStartTime:string; workEndTime:string;
  graceMinutes:number; workDays:number[]; departmentIds:string[]; appliesToAll:boolean;
}
interface Department { id:string; name:string; parentDeptId?:string; }
interface UserRecord { id:string; name?:string; email:string; department?:string; employeeId?:string; designation?:string; }

const parseTime = (t:string) => { const [h,m]=(t??"00:00").split(":").map(Number); return h*60+(m||0); };
const fmtHM = (mins:number) => {
  if (mins === 0) return "0h 00m";
  const sign = mins < 0 ? "-" : "+";
  const abs  = Math.abs(Math.round(mins));
  return `${sign}${Math.floor(abs/60)}h ${String(abs%60).padStart(2,"0")}m`;
};
const fmtDur = (mins:number) => `${Math.floor(mins/60)}h ${String(Math.round(mins%60)).padStart(2,"0")}m`;
const fmtTime = (ts:any) => {
  if(!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",hour12:false});
};
const getDS = (ts:any, dateStr?:string) => {
  if(dateStr) return dateStr;
  if(!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().split("T")[0];
};
const getDiffMins = (a:any, b:any) => {
  if(!a||!b) return 0;
  const da = a.toDate?a.toDate():new Date(a);
  const db2 = b.toDate?b.toDate():new Date(b);
  return Math.max(0, Math.round((db2.getTime()-da.getTime())/60000));
};
const DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function getDatesInMonth(year:number,mon:number):string[]{
  const dates:string[]=[];
  const end=new Date(year,mon,0);
  for(let d=new Date(year,mon-1,1);d<=end;d.setDate(d.getDate()+1))
    dates.push(d.toISOString().split("T")[0]);
  return dates;
}

// ── Open Session Approval Modal ───────────────────────────────────────────────
function OpenSessionModal({ record, type, policy, onClose, onSaved }:{
  record: AttRecord|CheckIn; type:"punch"|"checkin"; policy:Policy|null;
  onClose:()=>void; onSaved:()=>void;
}) {
  const { profile } = useAuth();
  const checkInTime = type==="punch" ? (record as AttRecord).punchInTime : (record as CheckIn).checkInTime;
  const policyEndMins = policy ? parseTime(policy.workEndTime) : 18*60;
  const inD = checkInTime?.toDate ? checkInTime.toDate() : new Date();
  const inMins = inD.getHours()*60+inD.getMinutes();
  const suggested = Math.max(0, policyEndMins - inMins);

  const [minutes, setMinutes] = useState(String(suggested));
  const [reason, setReason]   = useState("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");

  const handleApprove = async () => {
    const mins = parseInt(minutes);
    if(!mins || mins <= 0) { setError("Enter valid minutes."); return; }
    if(!reason.trim()) { setError("Reason is required."); return; }
    setSaving(true);
    try {
      const collName = type==="punch" ? "attendance" : "checkins";
      const timeField = type==="punch" ? "punchInTime" : "checkInTime";
      const outField  = type==="punch" ? "punchOutTime" : "checkOutTime";
      const inTime    = checkInTime?.toDate ? checkInTime.toDate() : new Date();
      const outTime   = new Date(inTime.getTime() + mins*60000);
      await updateDoc(doc(db, collName, record.id), {
        [outField]:       outTime,
        durationMinutes:  mins,
        status:           "approved",
        closedBy:         "manager",
        managerMinutes:   mins,
        closedReason:     reason.trim(),
        reviewedBy:       profile?.name ?? "Manager",
        reviewedAt:       serverTimestamp(),
      });
      onSaved(); onClose();
    } catch(e:any) { setError(e.message); } finally { setSaving(false); }
  };

  const r = record as any;
  const label = type==="punch"
    ? `Punch-in at ${fmtTime(checkInTime)} — no checkout recorded`
    : `Check-in at ${fmtTime(checkInTime)} (${r.clientName??r.siteName??"Visit"}) — no checkout`;

  return (
    <Modal title="Approve Open Session" onClose={onClose}>
      <div className="p-6 space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">⚠️ No checkout recorded</p>
          <p className="text-xs text-amber-700 mt-1">{label}</p>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">
            Minutes to credit *
            <span className="text-xs font-normal text-gray-400 ml-2">(suggested: {suggested} min = till policy end {policy?.workEndTime})</span>
          </label>
          <input type="number" min={1} max={720} value={minutes} onChange={e=>setMinutes(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {minutes && parseInt(minutes)>0 && (
            <p className="text-xs text-blue-600 mt-1">= {fmtDur(parseInt(minutes))} credited</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">Reason / Note *</label>
          <textarea value={reason} onChange={e=>setReason(e.target.value)} rows={3}
            placeholder="e.g. Employee confirmed they left at 5PM, internet was down"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>
        {error && <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50">Cancel</button>
          <button onClick={handleApprove} disabled={saving}
            className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-green-700 disabled:bg-green-300">
            {saving ? "Saving..." : `Credit ${minutes ? fmtDur(parseInt(minutes)||0) : "0m"}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function MonthlyReportPage() {
  const { isAdmin, isManager, isDirector } = useAuth();
  const [month, setMonth]           = useState(()=>new Date().toISOString().slice(0,7));
  const [depts, setDepts]           = useState<Department[]>([]);
  const [allUsers, setAllUsers]     = useState<UserRecord[]>([]);
  const [policies, setPolicies]     = useState<Policy[]>([]);
  const [filterDept, setFilterDept] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [view, setView]             = useState<"summary"|"detail">("summary");
  const [summaryData, setSummaryData] = useState<any[]>([]);
  const [detailRows, setDetailRows]   = useState<any[]>([]);
  const [detailUser, setDetailUser]   = useState<UserRecord|null>(null);
  const [detailPolicy, setDetailPolicy] = useState<Policy|null>(null);
  const [loading, setLoading]         = useState(false);
  const [openModal, setOpenModal]     = useState<{record:any;type:"punch"|"checkin";policy:Policy|null}|null>(null);

  useEffect(()=>{
    Promise.all([
      getDocs(query(collection(db,"departments"),where("active","==",true))),
      getDocs(collection(db,"users")),
      getDocs(query(collection(db,"policies"),where("active","==",true))),
    ]).then(([dSnap,uSnap,pSnap])=>{
      setDepts(dSnap.docs.map(d=>({id:d.id,...d.data()} as Department)));
      setAllUsers(uSnap.docs.map(d=>({id:d.id,...d.data()} as UserRecord)));
      setPolicies(pSnap.docs.map(d=>({id:d.id,...d.data()} as Policy)));
    });
  },[]);

  const getPolicyForUser=(u:UserRecord):Policy|null=>{
    if(!u.department) return policies.find(p=>p.appliesToAll)??null;
    return policies.find(p=>(p.departmentIds??[]).includes(u.department!))
      ??policies.find(p=>p.appliesToAll)??null;
  };

  const filteredUsers = allUsers.filter(u=>{
    if(filterDept && u.department!==filterDept) return false;
    if(filterUser && u.id!==filterUser) return false;
    return true;
  });

  const generate = async()=>{
    setLoading(true);
    try {
      const [year,mon]=month.split("-").map(Number);
      const start=new Date(year,mon-1,1);
      const end=new Date(year,mon,1);
      const targetUsers=filteredUsers.length>0?filteredUsers:allUsers;

      const [attSnap,ciSnap]=await Promise.all([
        getDocs(query(collection(db,"attendance"),where("timestamp",">=",start),where("timestamp","<",end))),
        getDocs(query(collection(db,"checkins"),where("checkInTime",">=",start),where("checkInTime","<",end))),
      ]);
      const allRecs  = attSnap.docs.map(d=>({id:d.id,...d.data()} as AttRecord));
      const allCIs   = ciSnap.docs.map(d=>({id:d.id,...d.data()} as CheckIn));

      const summary = targetUsers.map(u=>{
        const recs = allRecs.filter(r=>r.userId===u.id);
        const cis  = allCIs.filter(c=>c.userId===u.id);
        const policy = getPolicyForUser(u);
        const policyMins = policy?parseTime(policy.workEndTime)-parseTime(policy.workStartTime):480;
        let present=0,fieldDays=0,absent=0,leave=0,late=0,lateUnexcused=0,punchMins=0,ciMins=0,excessMins=0;
        const dayMap=new Map<string,{recs:AttRecord[];cis:CheckIn[]}>();
        for(const r of recs){
          const ds=getDS(r.timestamp,r.dateStr); if(!ds)continue;
          if(!dayMap.has(ds))dayMap.set(ds,{recs:[],cis:[]});
          dayMap.get(ds)!.recs.push(r);
        }
        for(const c of cis){
          const ds=getDS(c.checkInTime,c.dateStr); if(!ds)continue;
          if(!dayMap.has(ds))dayMap.set(ds,{recs:[],cis:[]});
          dayMap.get(ds)!.cis.push(c);
        }
        for(const[ds,day]of dayMap){
          const punches=day.recs.filter(r=>r.type==="punch-in"&&r.status==="approved"&&r.durationMinutes);
          const field=day.recs.find(r=>r.type==="field-day"&&r.status==="approved");
          const abs=day.recs.find(r=>r.type==="absent");
          const checkins=day.cis.filter(c=>c.status==="approved"&&c.durationMinutes);
          const dayPunch=punches.reduce((a,r)=>a+(r.durationMinutes??0),0);
          const dayCI=checkins.reduce((a,c)=>a+(c.durationMinutes??0),0);
          const dayTotal=field?policyMins:dayPunch+dayCI;
          const lateRec=day.recs.find(r=>r.lateStatus==="late");
          const latePen=lateRec?.lateApproved===false?(lateRec.lateMinutes??0):0;
          if(field){fieldDays++;excessMins+=0;}
          else if(punches.length>0||checkins.length>0){
            present++; punchMins+=dayPunch; ciMins+=dayCI;
            excessMins+=dayTotal-policyMins-latePen;
          }
          if(abs?.status==="approved")leave++;
          else if(abs)absent++;
          if(lateRec)late++;
          if(lateRec?.lateApproved===false)lateUnexcused++;
        }
        return{user:u,policy,present,fieldDays,absent,leave,late,lateUnexcused,punchMins,ciMins,totalMins:punchMins+ciMins,excessMins};
      });
      setSummaryData(summary);

      if(filterUser){
        const u=allUsers.find(x=>x.id===filterUser)!;
        const policy=getPolicyForUser(u);
        const policyMins=policy?parseTime(policy.workEndTime)-parseTime(policy.workStartTime):480;
        setDetailPolicy(policy); setDetailUser(u);
        const dates=getDatesInMonth(year,mon);
        const urecs=allRecs.filter(r=>r.userId===u.id);
        const ucis=allCIs.filter(c=>c.userId===u.id);
        const rows=dates.map(ds=>{
          const dayRecs=urecs.filter(r=>getDS(r.timestamp,r.dateStr)===ds);
          const dayCIs=ucis.filter(c=>getDS(c.checkInTime,c.dateStr)===ds);
          const d=new Date(ds+"T00:00:00");
          const weekday=DAYS[d.getDay()];
          const punchRecs=dayRecs.filter(r=>r.type==="punch-in");
          const approvedPunch=punchRecs.filter(r=>r.status==="approved"&&r.durationMinutes);
          const approvedCI=dayCIs.filter(c=>c.status==="approved"&&c.durationMinutes);
          const openPunch=punchRecs.filter(r=>r.status==="pending"&&!r.punchOutTime);
          const openCI=dayCIs.filter(c=>c.status==="pending"&&!c.checkOutTime);
          const fieldRec=dayRecs.find(r=>r.type==="field-day"&&r.status==="approved");
          const absRec=dayRecs.find(r=>r.type==="absent");
          const firstIn=punchRecs.sort((a,b)=>(a.punchInTime?.toDate?.()?.getTime()??0)-(b.punchInTime?.toDate?.()?.getTime()??0))[0];
          const lastOut=punchRecs.filter(r=>r.punchOutTime).sort((a,b)=>(b.punchOutTime?.toDate?.()?.getTime()??0)-(a.punchOutTime?.toDate?.()?.getTime()??0))[0];
          const firstCI=dayCIs.sort((a,b)=>(a.checkInTime?.toDate?.()?.getTime()??0)-(b.checkInTime?.toDate?.()?.getTime()??0))[0];
          const lastCO=dayCIs.filter(c=>c.checkOutTime).sort((a,b)=>(b.checkOutTime?.toDate?.()?.getTime()??0)-(a.checkOutTime?.toDate?.()?.getTime()??0))[0];
          const dayPunch=approvedPunch.reduce((a,r)=>a+(r.durationMinutes??0),0);
          const dayCI=approvedCI.reduce((a,c)=>a+(c.durationMinutes??0),0);
          const dayTotal=fieldRec?policyMins:dayPunch+dayCI;
          const lateRec=punchRecs.find(r=>r.lateStatus==="late");
          const latePen=lateRec?.lateApproved===false?(lateRec.lateMinutes??0):0;
          const hasActivity=punchRecs.length>0||dayCIs.length>0||fieldRec||absRec;
          const excessMins=!hasActivity||absRec?null:(fieldRec?0:dayTotal-policyMins-latePen);
          // Early going
          let earlyGoing=false;
          if(policy&&lastOut?.punchOutTime&&!fieldRec&&dayCIs.length===0){
            const outD=lastOut.punchOutTime.toDate?lastOut.punchOutTime.toDate():new Date(lastOut.punchOutTime);
            earlyGoing=outD.getHours()*60+outD.getMinutes()<parseTime(policy.workEndTime)-30;
          }
          // Remarks
          const remarks:string[]=[];
          if(fieldRec)remarks.push(`Field Day${fieldRec.reviewReason?` — ${fieldRec.reviewReason}`:""}`);
          else if(absRec?.status==="approved")remarks.push("Leave Approved");
          if(lateRec)remarks.push(`Late ${lateRec.lateMinutes}min${lateRec.lateApproved===true?" (Excused)":lateRec.lateApproved===false?" (Unexcused)":""}`);
          if(earlyGoing&&lastOut?.punchOutTime){
            const outD=lastOut.punchOutTime.toDate?lastOut.punchOutTime.toDate():new Date(lastOut.punchOutTime);
            const earlyBy=(parseTime(policy!.workEndTime))-(outD.getHours()*60+outD.getMinutes());
            if(earlyBy>0)remarks.push(`Left early ${Math.floor(earlyBy/60)}h ${earlyBy%60}m`);
          }
          if(openPunch.length>0)remarks.push("⚠️ Open punch session");
          if(openCI.length>0)remarks.push("⚠️ Open check-in");
          return{date:ds,weekday,firstIn,lastOut,firstCI,lastCO,dayPunch,dayCI,dayTotal,excessMins,
            remarks:remarks.join(" · "),fieldRec,absRec,punchRecs,dayCIs,earlyGoing,openPunch,openCI,lateRec,policy};
        });
        setDetailRows(rows);
        setView("detail");
      } else {
        setView("summary");
      }
    } finally{setLoading(false);}
  };

  const exportCSV=()=>{
    if(view==="summary"){
      const h=["Employee","Dept","Present","Field Days","Absent","Leave","Late","Unexcused","Punch Hrs","CI Hrs","Total Hrs","Excess/Short"];
      const rows=summaryData.map(d=>[d.user.name??d.user.email,depts.find(x=>x.id===d.user.department)?.name??"—",d.present,d.fieldDays,d.absent,d.leave,d.late,d.lateUnexcused,(d.punchMins/60).toFixed(1),(d.ciMins/60).toFixed(1),(d.totalMins/60).toFixed(1),fmtHM(d.excessMins)]);
      const csv=[h,...rows].map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(",")).join("\n");
      const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`monthly_summary_${month}.csv`;a.click();
    } else if(detailUser){
      const h=["Date","Weekday","Punch In","Punch Out","Check-in","Check-out","Punch Hrs","CI Hrs","Total","Excess/Short","Remarks"];
      const rows=detailRows.map(r=>[r.date,r.weekday,fmtTime(r.firstIn?.punchInTime),fmtTime(r.lastOut?.punchOutTime),fmtTime(r.firstCI?.checkInTime),fmtTime(r.lastCO?.checkOutTime),r.dayPunch?(r.dayPunch/60).toFixed(2):"",r.dayCI?(r.dayCI/60).toFixed(2):"",r.dayTotal?(r.dayTotal/60).toFixed(2):"",r.excessMins!=null?fmtHM(r.excessMins):"",r.remarks]);
      const csv=[h,...rows].map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(",")).join("\n");
      const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`monthly_${detailUser.name??detailUser.id}_${month}.csv`;a.click();
    }
  };

  const exportPDF=()=>{
    if(!detailUser||view!=="detail")return;
    const deptName=depts.find(x=>x.id===detailUser.department)?.name??"—";
    const parentDept=depts.find(x=>x.id===depts.find(d=>d.id===detailUser.department)?.parentDeptId);
    const totalExcess=detailRows.reduce((a,r)=>a+(r.excessMins??0),0);
    const absCount=detailRows.filter(r=>r.absRec&&r.absRec.status!=="approved").length;
    const absApproved=detailRows.filter(r=>r.absRec&&r.absRec.status==="approved").length;
    const lateCount=detailRows.filter(r=>r.lateRec).length;
    const lateUnexc=detailRows.filter(r=>r.lateRec?.lateApproved===false).length;
    const earlyCount=detailRows.filter(r=>r.earlyGoing).length;
    const notPunched=detailRows.filter(r=>r.punchRecs.length===0&&r.dayCIs.length===0&&!r.absRec&&!r.fieldRec).length;
    const rows=detailRows.map((r,i)=>{
      const bg=r.absRec?"#fee2e2":r.fieldRec?"#e0f2fe":r.openPunch.length>0||r.openCI.length>0?"#fffbeb":i%2===0?"#fff":"#f9fafb";
      const exStr=r.excessMins!=null?fmtHM(r.excessMins):"";
      const exColor=r.excessMins==null?"":r.excessMins<0?"#dc2626":"#16a34a";
      return `<tr style="background:${bg}">
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:12px">${r.date}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:12px">${r.weekday}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:12px">${fmtTime(r.firstIn?.punchInTime)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:12px">${fmtTime(r.lastOut?.punchOutTime)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:12px">${fmtTime(r.firstCI?.checkInTime)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:12px">${fmtTime(r.lastCO?.checkOutTime)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:11px;text-align:center">${r.dayPunch?fmtDur(r.dayPunch):""}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:11px;text-align:center">${r.dayCI?fmtDur(r.dayCI):""}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-weight:700;color:${exColor};text-align:center;font-size:12px">${exStr}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;color:#555;font-size:11px">${r.remarks}</td>
      </tr>`;
    }).join("");
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Monthly — ${detailUser.name??detailUser.email} — ${month}</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;padding:20px;color:#111;font-size:13px}
    .hdr{display:flex;justify-content:space-between;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #1565c0}
    .hdr h1{font-size:18px;font-weight:700;color:#1565c0}.hdr p{color:#666;margin-top:3px;font-size:12px}
    .hdr-r{text-align:right}.hdr-r p{font-size:12px;color:#444;margin-bottom:2px}
    .layout{display:flex;gap:16px}.tbl{flex:1}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#1565c0;color:#fff;padding:8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px}
    .tot td{background:#1e3a5f;color:#fff;font-weight:700;padding:8px}
    .sb{width:160px;flex-shrink:0}.card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px;text-align:center}
    .card .v{font-size:24px;font-weight:700;color:#1565c0}.card .l{font-size:9px;text-transform:uppercase;color:#666;margin-top:3px}
    .sub{display:flex;gap:4px;margin-top:5px}.sub div{flex:1;background:#fff;border-radius:4px;padding:4px;text-align:center}
    .sub .sv{font-size:14px;font-weight:700}.sub .sl{font-size:8px;color:#888;text-transform:uppercase}
    @media print{body{padding:12px}}</style></head><body>
    <div class="hdr">
      <div><h1>${detailUser.name??detailUser.email}</h1>
        <p>${[detailUser.designation,detailUser.employeeId].filter(Boolean).join(" · ")}</p>
        <p style="color:#1565c0;font-weight:600;margin-top:3px">${new Date(month+"-01").toLocaleDateString([],{month:"long",year:"numeric"})}</p></div>
      <div class="hdr-r"><p style="font-weight:600">${deptName}</p>${parentDept?`<p style="color:#888">${parentDept.name}</p>`:""}<p style="color:#aaa;font-size:10px;margin-top:3px">Generated ${new Date().toLocaleString()}</p></div>
    </div>
    <div class="layout"><div class="tbl"><table>
      <thead><tr><th>Date</th><th>Day</th><th>Punch In</th><th>Punch Out</th><th>CI</th><th>CO</th><th style="text-align:center">Punch Hrs</th><th style="text-align:center">CI Hrs</th><th style="text-align:center">Excess/Short</th><th>Remarks</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="tot"><td colspan="8">TOTAL</td>
        <td style="text-align:center;color:${totalExcess<0?"#fca5a5":"#86efac"}">${fmtHM(totalExcess)}</td><td></td>
      </tr></tfoot></table></div>
    <div class="sb">
      <div class="card ${absCount+absApproved>0?"danger":""}"><div class="v" style="${absCount+absApproved>0?"color:#dc2626":""}">${absCount+absApproved}</div><div class="l">Absences</div>
        <div class="sub"><div><div class="sv" style="color:#16a34a">${absApproved}</div><div class="sl">Approved</div></div><div><div class="sv" style="color:#dc2626">${absCount}</div><div class="sl">Unapproved</div></div></div></div>
      <div class="card"><div class="v" style="${notPunched>0?"color:#d97706":""}">${notPunched}</div><div class="l">Not Punched</div></div>
      <div class="card"><div class="v" style="font-size:18px;${totalExcess<0?"color:#dc2626":"color:#16a34a"}">${fmtHM(totalExcess)}</div><div class="l">Excess / Short</div></div>
      <div class="card"><div class="v" style="${lateCount>0?"color:#d97706":""}">${lateCount}</div><div class="l">Late Comings</div>
        <div class="sub"><div><div class="sv" style="color:#16a34a">${lateCount-lateUnexc}</div><div class="sl">Excused</div></div><div><div class="sv" style="color:#dc2626">${lateUnexc}</div><div class="sl">Unexcused</div></div></div></div>
      <div class="card"><div class="v" style="${earlyCount>0?"color:#d97706":""}">${earlyCount}</div><div class="l">Early Goings</div></div>
    </div></div>
    <script>window.onload=()=>window.print();</script></body></html>`;
    const w=window.open("","_blank");if(w){w.document.write(html);w.document.close();}
  };

  const userOptions=filterDept?allUsers.filter(u=>u.department===filterDept):allUsers;

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monthly Report</h1>
          <p className="text-gray-500 text-sm mt-1">Select employee for detailed view with check-in breakdown</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700">CSV ↓</button>
          <button onClick={exportPDF} disabled={view!=="detail" || !detailUser}
            className="bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700">
            🖨️ <span>PDF</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">Month</label>
          <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">Department</label>
          <select value={filterDept} onChange={e=>{setFilterDept(e.target.value);setFilterUser("");}}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-40">
            <option value="">All departments</option>
            {depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">Employee</label>
          <select value={filterUser} onChange={e=>setFilterUser(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-48">
            <option value="">All (summary view)</option>
            {userOptions.map(u=><option key={u.id} value={u.id}>{u.name??u.email}</option>)}
          </select>
        </div>
        <button onClick={generate} disabled={loading}
          className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300">
          {loading?"Generating...":"Generate"}
        </button>
      </div>

      {/* ── SUMMARY ── */}
      {view==="summary" && summaryData.length>0 && (
        <>
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[{l:"Employees",v:summaryData.length,c:"bg-blue-100 text-blue-700"},
              {l:"Total Present",v:summaryData.reduce((a,d)=>a+d.present,0),c:"bg-green-100 text-green-700"},
              {l:"Total Absent",v:summaryData.reduce((a,d)=>a+d.absent,0),c:"bg-red-100 text-red-700"},
              {l:"Total Late",v:summaryData.reduce((a,d)=>a+d.late,0),c:"bg-orange-100 text-orange-700"},
            ].map(s=>(
              <div key={s.l} className={`${s.c} rounded-xl p-4 text-center`}>
                <p className="text-2xl font-bold">{s.v}</p>
                <p className="text-xs font-semibold mt-1">{s.l}</p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="bg-gray-50 border-b border-gray-100">
                  {["Employee","Dept","Present","Field","Absent","Leave","Late","Unexcused","Punch Hrs","CI Hrs","Total","Excess/Short"].map(h=>(
                    <th key={h} className="px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {summaryData.map((d,i)=>(
                    <tr key={d.user.id} onClick={()=>{setFilterUser(d.user.id);}}
                      className={`border-b border-gray-50 cursor-pointer hover:bg-blue-50 ${i%2===0?"":"bg-gray-50/50"}`}>
                      <td className="px-3 py-3">
                        <p className="text-sm font-semibold text-gray-800">{d.user.name??d.user.email}</p>
                        {d.user.employeeId&&<p className="text-xs text-blue-500 font-mono">{d.user.employeeId}</p>}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500">{depts.find(x=>x.id===d.user.department)?.name??"—"}</td>
                      <td className="px-3 py-3 text-sm font-bold text-green-600">{d.present}</td>
                      <td className="px-3 py-3 text-sm font-bold text-blue-600">{d.fieldDays}</td>
                      <td className="px-3 py-3 text-sm font-bold text-red-600">{d.absent}</td>
                      <td className="px-3 py-3 text-sm text-gray-600">{d.leave}</td>
                      <td className="px-3 py-3 text-sm text-orange-600">{d.late}</td>
                      <td className="px-3 py-3 text-sm text-red-500">{d.lateUnexcused}</td>
                      <td className="px-3 py-3 text-xs text-gray-600">{(d.punchMins/60).toFixed(1)}h</td>
                      <td className="px-3 py-3 text-xs text-gray-600">{(d.ciMins/60).toFixed(1)}h</td>
                      <td className="px-3 py-3 text-xs font-semibold text-gray-700">{(d.totalMins/60).toFixed(1)}h</td>
                      <td className="px-3 py-3 text-sm font-bold" style={{color:d.excessMins<0?"#dc2626":"#16a34a"}}>{fmtHM(d.excessMins)}</td>
                    </tr>
                  ))}
                  <tr className="bg-blue-50 font-bold border-t-2 border-blue-200">
                    <td className="px-3 py-3 text-sm text-blue-800" colSpan={2}>TOTALS</td>
                    <td className="px-3 py-3 text-sm text-green-700">{summaryData.reduce((a,d)=>a+d.present,0)}</td>
                    <td className="px-3 py-3 text-sm text-blue-700">{summaryData.reduce((a,d)=>a+d.fieldDays,0)}</td>
                    <td className="px-3 py-3 text-sm text-red-700">{summaryData.reduce((a,d)=>a+d.absent,0)}</td>
                    <td className="px-3 py-3 text-sm text-gray-700">{summaryData.reduce((a,d)=>a+d.leave,0)}</td>
                    <td className="px-3 py-3 text-sm text-orange-700">{summaryData.reduce((a,d)=>a+d.late,0)}</td>
                    <td className="px-3 py-3 text-sm text-red-600">{summaryData.reduce((a,d)=>a+d.lateUnexcused,0)}</td>
                    <td className="px-3 py-3 text-xs font-bold">{(summaryData.reduce((a,d)=>a+d.punchMins,0)/60).toFixed(1)}h</td>
                    <td className="px-3 py-3 text-xs font-bold">{(summaryData.reduce((a,d)=>a+d.ciMins,0)/60).toFixed(1)}h</td>
                    <td className="px-3 py-3 text-xs font-bold">{(summaryData.reduce((a,d)=>a+d.totalMins,0)/60).toFixed(1)}h</td>
                    <td className="px-3 py-3 text-sm font-bold" style={{color:summaryData.reduce((a,d)=>a+d.excessMins,0)<0?"#dc2626":"#16a34a"}}>{fmtHM(summaryData.reduce((a,d)=>a+d.excessMins,0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 text-center py-3">Click any employee row to view detailed report</p>
          </div>
        </>
      )}

      {/* ── DETAIL ── */}
      {view==="detail" && detailUser && (
        <>
          <div className="flex gap-3 items-center mb-4">
            <button onClick={()=>setView("summary")} className="text-sm text-blue-600 border border-blue-200 px-4 py-2 rounded-xl hover:bg-blue-50 font-semibold">← Back</button>
            <button onClick={generate} className="text-sm text-gray-600 border border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-50 font-semibold">↻ Refresh</button>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{detailUser.name??detailUser.email}</h2>
                {detailUser.designation&&<p className="text-sm text-gray-500 mt-0.5">{detailUser.designation}</p>}
                {detailUser.employeeId&&<p className="text-xs text-blue-500 font-mono mt-1">{detailUser.employeeId}</p>}
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-700">{depts.find(x=>x.id===detailUser.department)?.name??"—"}</p>
                {(()=>{const sub=depts.find(x=>x.id===detailUser.department);const par=depts.find(x=>x.id===sub?.parentDeptId);return par?<p className="text-sm text-gray-400">{par.name}</p>:null;})()}
                <p className="text-xs text-gray-400 mt-1">{new Date(month+"-01").toLocaleDateString([],{month:"long",year:"numeric"})}</p>
                {detailPolicy&&<p className="text-xs text-blue-500 mt-0.5">Policy: {detailPolicy.workStartTime}–{detailPolicy.workEndTime} ({fmtDur(parseTime(detailPolicy.workEndTime)-parseTime(detailPolicy.workStartTime))} day)</p>}
              </div>
            </div>
          </div>

          <div className="flex gap-5">
            {/* Table */}
            <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-gray-900 border-b border-gray-700">
                    {["Date","Day","Punch In","Punch Out","CI","CO","Punch Hrs","CI Hrs","Excess/Short","Remarks"].map(h=>(
                      <th key={h} className="px-3 py-3 text-left text-xs font-bold text-gray-300 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {detailRows.map((r,i)=>{
                      const rowBg=r.openPunch.length>0||r.openCI.length>0?"bg-amber-50":r.absRec?"bg-red-50":r.fieldRec?"bg-blue-50":i%2===0?"":"bg-gray-50/40";
                      const exColor=r.excessMins==null?"text-gray-300":r.excessMins<0?"text-red-600 font-bold":"text-green-600 font-bold";
                      return(
                        <tr key={r.date} className={`border-b border-gray-50 ${rowBg}`}>
                          <td className="px-3 py-2.5 font-mono text-gray-600">{r.date}</td>
                          <td className="px-3 py-2.5 text-gray-500">{r.weekday}</td>
                          <td className="px-3 py-2.5 font-mono text-gray-700">{fmtTime(r.firstIn?.punchInTime)}</td>
                          <td className="px-3 py-2.5 font-mono text-gray-700">{fmtTime(r.lastOut?.punchOutTime)}</td>
                          <td className="px-3 py-2.5 font-mono text-gray-500">{fmtTime(r.firstCI?.checkInTime)}</td>
                          <td className="px-3 py-2.5 font-mono text-gray-500">{fmtTime(r.lastCO?.checkOutTime)}</td>
                          <td className="px-3 py-2.5 text-center text-gray-600">{r.dayPunch?fmtDur(r.dayPunch):""}</td>
                          <td className="px-3 py-2.5 text-center text-gray-500">{r.dayCI?fmtDur(r.dayCI):""}</td>
                          <td className={`px-3 py-2.5 text-center ${exColor}`}>{r.excessMins!=null?fmtHM(r.excessMins):"—"}</td>
                          <td className="px-3 py-2.5 text-gray-500 max-w-xs">
                            <span className={r.openPunch.length>0||r.openCI.length>0?"text-amber-600 font-semibold":""}>{r.remarks}</span>
                            {(r.openPunch.length>0||r.openCI.length>0)&&(
                              <button onClick={()=>setOpenModal({
                                record:r.openPunch[0]??r.openCI[0],
                                type:r.openPunch.length>0?"punch":"checkin",
                                policy:r.policy
                              })} className="ml-2 text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded font-semibold hover:bg-amber-200">
                                Approve
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-gray-900 border-t-2 border-gray-700">
                      <td colSpan={8} className="px-3 py-3 text-sm font-bold text-white">TOTAL</td>
                      <td className={`px-3 py-3 text-sm font-bold text-center whitespace-nowrap ${detailRows.reduce((a,r)=>a+(r.excessMins??0),0)<0?"text-white":"text-green-300"}`}>
                        {fmtHM(detailRows.reduce((a,r)=>a+(r.excessMins??0),0))}
                      </td>
                      <td className="px-3 py-3"/>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sidebar cards */}
            <div className="w-44 flex-shrink-0 space-y-3">
              {(()=>{
                const absCount=detailRows.filter(r=>r.absRec&&r.absRec.status!=="approved").length;
                const absApproved=detailRows.filter(r=>r.absRec&&r.absRec.status==="approved").length;
                const notPunched=detailRows.filter(r=>r.punchRecs.length===0&&r.dayCIs.length===0&&!r.absRec&&!r.fieldRec).length;
                const totalExcess=detailRows.reduce((a,r)=>a+(r.excessMins??0),0);
                const lateCount=detailRows.filter(r=>r.lateRec).length;
                const lateUnexc=detailRows.filter(r=>r.lateRec?.lateApproved===false).length;
                const earlyCount=detailRows.filter(r=>r.earlyGoing).length;
                const openSessions=detailRows.filter(r=>r.openPunch.length>0||r.openCI.length>0).length;
                return<>
                  {openSessions>0&&(
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
                      <p className="text-2xl font-bold text-amber-600">{openSessions}</p>
                      <p className="text-xs font-semibold text-amber-500 uppercase mt-1">Open Sessions</p>
                      <p className="text-xs text-amber-600 mt-1">Need approval</p>
                    </div>
                  )}
                  <div className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
                    <p className={`text-3xl font-bold ${absCount+absApproved>0?"text-red-600":"text-gray-800"}`}>{absCount+absApproved}</p>
                    <p className="text-xs font-semibold text-gray-400 uppercase mt-1">Absences</p>
                    <div className="flex gap-2 mt-2">
                      <div className="flex-1 bg-green-50 rounded-lg p-1.5 text-center">
                        <p className="text-base font-bold text-green-600">{absApproved}</p>
                        <p className="text-xs text-gray-400">Approved</p>
                      </div>
                      <div className="flex-1 bg-red-50 rounded-lg p-1.5 text-center">
                        <p className="text-base font-bold text-red-600">{absCount}</p>
                        <p className="text-xs text-gray-400">Unapproved</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
                    <p className={`text-3xl font-bold ${notPunched>0?"text-amber-600":"text-gray-800"}`}>{notPunched}</p>
                    <p className="text-xs font-semibold text-gray-400 uppercase mt-1">Not Punched</p>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
                    <p className={`text-2xl font-bold ${totalExcess<0?"text-red-600":"text-green-600"}`}>{fmtHM(totalExcess)}</p>
                    <p className="text-xs font-semibold text-gray-400 uppercase mt-1">Excess / Short</p>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
                    <p className={`text-3xl font-bold ${lateCount>0?"text-orange-600":"text-gray-800"}`}>{lateCount}</p>
                    <p className="text-xs font-semibold text-gray-400 uppercase mt-1">Late Comings</p>
                    <div className="flex gap-2 mt-2">
                      <div className="flex-1 bg-green-50 rounded-lg p-1.5 text-center">
                        <p className="text-base font-bold text-green-600">{lateCount-lateUnexc}</p>
                        <p className="text-xs text-gray-400">Excused</p>
                      </div>
                      <div className="flex-1 bg-red-50 rounded-lg p-1.5 text-center">
                        <p className="text-base font-bold text-red-600">{lateUnexc}</p>
                        <p className="text-xs text-gray-400">Unexcused</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
                    <p className={`text-3xl font-bold ${earlyCount>0?"text-orange-600":"text-gray-800"}`}>{earlyCount}</p>
                    <p className="text-xs font-semibold text-gray-400 uppercase mt-1">Early Goings</p>
                  </div>
                </>;
              })()}
            </div>
          </div>
        </>
      )}

      {/* Open Session Approval Modal */}
      {openModal && (
        <OpenSessionModal
          record={openModal.record}
          type={openModal.type}
          policy={openModal.policy}
          onClose={()=>setOpenModal(null)}
          onSaved={generate}
        />
      )}
    </div>
  );
}

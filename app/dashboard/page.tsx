"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { getTeamMembersForManager, getDirectorMembers } from "@/lib/team-utils";

interface Stats {
  totalUsers:number; presentToday:number; absentToday:number;
  pendingApprovals:number; lateToday:number; activeCheckIns:number;
}

function StatCard({ label, value, icon, color, sub }: {
  label:string; value:number|string; icon:string; color:string; sub?:string;
}) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{label}</p>
          <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { profile, isAdmin, isManager, isDirector, user } = useAuth();
  const [stats, setStats]   = useState<Stats|null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if(user) loadStats(); }, [user, isAdmin, isDirector]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
      const todayStr = (() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();

      // Step 1: determine which user IDs this viewer can see
      let memberUids: string[] = [];
      if (!isAdmin && user) {
        const members = isDirector
          ? await getDirectorMembers(user.uid, db)
          : await getTeamMembersForManager(user.uid, db);
        memberUids = members.map((m:any) => m.id);
      }

      // Step 2: fetch raw data
      // For attendance: query by timestamp (punch-ins) AND by dateStr=today (absent/field-day)
      const [usersSnap, attTsSnap, attDsSnap, ciSnap] = await Promise.all([
        getDocs(query(collection(db,"users"), where("device.approved","==",true))),
        getDocs(query(collection(db,"attendance"), where("timestamp",">=",startOfDay))),
        getDocs(query(collection(db,"attendance"), where("dateStr","==",todayStr))),
        getDocs(query(collection(db,"checkins"),   where("timestamp",">=",startOfDay))),
      ]);

      // Merge attendance: punch-ins from timestamp query, absent/field-day ONLY from dateStr query
      const seen = new Set<string>();
      let att: any[] = [];
      attTsSnap.docs.forEach(d => {
        const r = d.data() as any;
        if (r.type !== "absent" && r.type !== "field-day") {
          if(!seen.has(d.id)){seen.add(d.id); att.push({id:d.id, ...r});}
        }
      });
      attDsSnap.docs.forEach(d => {
        if(!seen.has(d.id)){seen.add(d.id); att.push({id:d.id, ...d.data()} as any);}
      });

      let ci  = ciSnap.docs.map(d=>({id:d.id,...d.data()} as any));
      let allUsers = usersSnap.docs.map(d=>({id:d.id,...d.data()} as any));

      // Step 3: filter to team members for non-admins
      if (!isAdmin && memberUids.length > 0) {
        att      = att.filter((a:any)      => memberUids.includes(a.userId));
        ci       = ci.filter((c:any)       => memberUids.includes(c.userId));
        allUsers = allUsers.filter((u:any) => memberUids.includes(u.id));
      }

      setStats({
        totalUsers:       isAdmin ? usersSnap.size : allUsers.length,
        presentToday:     att.filter(a=>a.type==="punch-in").length,
        absentToday:      att.filter(a=>a.type==="absent").length,
        pendingApprovals: [...att.filter(a=>a.status==="pending"||a.status==="absent"), ...ci.filter(c=>c.status==="pending")].length,
        lateToday:        att.filter(a=>a.lateStatus==="late").length,
        activeCheckIns:   ci.filter(c=>!c.checkOutTime&&c.status!=="rejected").length,
      });
    } catch(e) { console.error("Dashboard error:", e); }
    finally { setLoading(false); }
  };

  const greeting = () => {
    const h = new Date().getHours();
    return h<12?"Good morning":h<17?"Good afternoon":"Good evening";
  };

  const viewLabel = isAdmin?"All employees":isDirector?"Your departments":"Your team";

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {greeting()}, {profile?.name ?? profile?.email?.split("@")[0]} 👋
        </h1>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <p className="text-gray-500">
            {new Date().toLocaleDateString("en-PK",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}
          </p>
          <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
            isAdmin?"bg-red-100 text-red-700":isDirector?"bg-purple-100 text-purple-700":"bg-blue-100 text-blue-700"
          }`}>
            {viewLabel}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {Array.from({length:6}).map((_,i)=>(
            <div key={i} className="bg-white rounded-2xl p-6 border border-gray-100 animate-pulse h-28"/>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <StatCard label="Present Today"     value={stats?.presentToday??0}     icon="✅" color="text-green-600"  sub="Punched in today"/>
          <StatCard label="Absent Today"      value={stats?.absentToday??0}      icon="❌" color="text-red-600"    sub="No punch-in"/>
          <StatCard label="Pending Approvals" value={stats?.pendingApprovals??0} icon="⏳" color="text-amber-600"  sub="Needs your review"/>
          <StatCard label="Late Arrivals"     value={stats?.lateToday??0}        icon="🕐" color="text-orange-600" sub="After grace period"/>
          <StatCard label="Active Check-ins"  value={stats?.activeCheckIns??0}   icon="🚗" color="text-blue-600"   sub="Currently out"/>
          <StatCard
            label={isAdmin?"Total Employees":isDirector?"Dept employees":"Team members"}
            value={stats?.totalUsers??0} icon="👤" color="text-gray-700"
            sub={isAdmin?"Approved devices":isDirector?"Across your departments":"In your department"}
          />
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-4">Quick actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {href:"/attendance",      label:"Live Attendance",icon:"📋",color:"bg-blue-50 text-blue-700 hover:bg-blue-100"},
            {href:"/approvals",       label:"Approvals",      icon:"✅",color:"bg-amber-50 text-amber-700 hover:bg-amber-100"},
            {href:"/reports/daily",   label:"Daily Report",   icon:"📅",color:"bg-green-50 text-green-700 hover:bg-green-100"},
            {href:"/reports/monthly", label:"Monthly Report", icon:"🗓️",color:"bg-purple-50 text-purple-700 hover:bg-purple-100"},
            ...(isAdmin?[
              {href:"/users",         label:"Manage Users",   icon:"👤",color:"bg-gray-50 text-gray-700 hover:bg-gray-100"},
              {href:"/devices",       label:"Device Approvals",icon:"📱",color:"bg-teal-50 text-teal-700 hover:bg-teal-100"},
            ]:[]),
          ].map(item=>(
            <a key={item.href} href={item.href}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${item.color}`}>
              <span className="text-2xl">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

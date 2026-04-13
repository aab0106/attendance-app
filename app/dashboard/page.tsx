"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { getTeamMembersForManager, getDirectorMembers } from "@/lib/team-utils";


interface Stats {
  totalUsers: number;
  presentToday: number;
  absentToday: number;
  pendingApprovals: number;
  lateToday: number;
  activeCheckIns: number;
}

function StatCard({ label, value, icon, color, sub }: {
  label: string; value: number | string; icon: string;
  color: string; sub?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl p-6 border border-gray-100 shadow-sm`}>
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
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);

      // Get dept member UIDs for manager/director filtering
      let memberUids: string[] = [];
      if (!isAdmin && user) {
        const members = isDirector
          ? await getDirectorMembers(user.uid, db)
          : await getTeamMembersForManager(user.uid, db);
        memberUids = members.map((m: any) => m.id);
      }

      const [usersSnap, attendanceSnap, checkinsSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("device.approved", "==", true))),
        getDocs(query(collection(db, "attendance"), where("timestamp", ">=", startOfDay))),
        getDocs(query(collection(db, "checkins"), where("timestamp", ">=", startOfDay))),
      ]);

      let attendance = attendanceSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      let checkins   = checkinsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      // Filter to dept members for non-admins
      if (!isAdmin && memberUids.length > 0) {
        attendance = attendance.filter((a: any) => memberUids.includes(a.userId));
        checkins   = checkins.filter((c: any) => memberUids.includes(c.userId));
      }

      const presentToday   = attendance.filter(a => a.type === "punch-in").length;
      const absentToday    = attendance.filter(a => a.type === "absent").length;
      const lateToday      = attendance.filter(a => a.lateStatus === "late").length;
      const activeCheckIns = checkins.filter(c => !c.checkOutTime).length;
      const pendingApprovals = [
        ...attendance.filter(a => a.status === "pending"),
        ...checkins.filter(c => c.status === "pending"),
      ].length;

      setStats({
        totalUsers: usersSnap.size,
        presentToday,
        absentToday,
        pendingApprovals,
        lateToday,
        activeCheckIns,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const greeting = () => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {greeting()}, {profile?.name ?? profile?.email?.split("@")[0]} 👋
        </h1>
        <p className="text-gray-500 mt-1">
          {new Date().toLocaleDateString("en-PK", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          {!isAdmin && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">{isDirector ? "Director view" : "Your team only"}</span>}
        </p>
      </div>

      {/* Stats Grid */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({length:6}).map((_,i) => (
            <div key={i} className="bg-white rounded-2xl p-6 border border-gray-100 animate-pulse h-28" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <StatCard label="Present Today"      value={stats?.presentToday ?? 0}     icon="✅" color="text-green-600"  sub="Punched in today" />
          <StatCard label="Absent Today"       value={stats?.absentToday ?? 0}      icon="❌" color="text-red-600"    sub="No punch-in" />
          <StatCard label="Pending Approvals"  value={stats?.pendingApprovals ?? 0} icon="⏳" color="text-amber-600"  sub="Needs review" />
          <StatCard label="Late Arrivals"      value={stats?.lateToday ?? 0}        icon="🕐" color="text-orange-600" sub="After grace period" />
          <StatCard label="Active Check-ins"   value={stats?.activeCheckIns ?? 0}   icon="🚗" color="text-blue-600"   sub="Currently out" />
          <StatCard label="Total Employees"    value={stats?.totalUsers ?? 0}       icon="👤" color="text-gray-700"   sub="Approved devices" />
        </div>
      )}

      {/* Quick links */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-4">Quick actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: "/attendance",       label: "Live Attendance", icon: "📋", color: "bg-blue-50 text-blue-700 hover:bg-blue-100" },
            { href: "/reports/daily",    label: "Daily Report",    icon: "📅", color: "bg-green-50 text-green-700 hover:bg-green-100" },
            { href: "/reports/monthly",  label: "Monthly Report",  icon: "🗓️", color: "bg-purple-50 text-purple-700 hover:bg-purple-100" },
            ...(isAdmin ? [{ href: "/users", label: "Manage Users", icon: "👤", color: "bg-amber-50 text-amber-700 hover:bg-amber-100" }] : []),
          ].map(item => (
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

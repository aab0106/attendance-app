"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

const NAV_ITEMS = [
  { href: "/dashboard",    label: "Dashboard",    icon: "📊", roles: ["admin","manager","hr","director"] },
  { href: "/attendance",   label: "Live Attendance",icon: "📋", roles: ["admin","manager","director","hr"] },
  { href: "/approvals",    label: "Approvals",    icon: "✅", roles: ["admin","manager","director","hr"] },
  { href: "/leaves",       label: "Leave Requests", icon: "📋", roles: ["admin","manager","director","hr"] },
  { href: "/users",        label: "Users",        icon: "👤", roles: ["admin"] },
  { href: "/devices",      label: "Device Approvals", icon: "📱", roles: ["admin"] },
  { href: "/departments",  label: "Departments",  icon: "🏢", roles: ["admin"] },
  { href: "/holidays",     label: "Holidays & Notifications", icon: "🏖️", roles: ["admin"] },
  { href: "/policies",     label: "Policies",     icon: "📜", roles: ["admin"] },
  { href: "/sites",        label: "Sites",        icon: "📍", roles: ["admin"] },
  { href: "/settings",     label: "Settings",     icon: "⚙️", roles: ["admin"] },
];

const REPORT_ITEMS = [
  { href: "/reports/daily",   label: "Daily Report",   icon: "📅", roles: ["admin","manager","hr","director"] },
  { href: "/reports/monthly", label: "Monthly Report", icon: "🗓️", roles: ["admin","manager","hr","director"] },
  { href: "/reports/late",    label: "Late Report",    icon: "🕐", roles: ["admin","manager","director","hr"] },
  { href: "/reports/visits",  label: "Visit Report",   icon: "🚗", roles: ["admin","manager","director","hr"] },
  { href: "/reports/leaves",  label: "Leave Report",   icon: "📋", roles: ["admin","manager","director","hr"] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { profile, isAdmin, isDirector, isManager, isHR, signOut } = useAuth();

  const userRoles: string[] = (() => {
    const r = profile?.role;
    if (!r) return [];
    if (Array.isArray(r)) return r;
    return (r as string).split(",").map((x: string) => x.trim());
  })();

  const canSee = (roles: string[]) =>
    roles.some(r =>
      (r === "admin" && isAdmin) ||
      (r === "director" && (isDirector || isAdmin)) ||
      (r === "manager" && isManager) ||
      (r === "hr" && isHR) ||
      userRoles.includes(r)
    );

  const initials = (profile?.name ?? profile?.email ?? "?")[0].toUpperCase();
  const roleLabel = isAdmin ? "Admin" : isManager ? "Manager" : isHR ? "HR" : "Staff";

  const [reportsOpen, setReportsOpen] = useState(pathname.startsWith("/reports"));
  const visibleReports = REPORT_ITEMS.filter(item => canSee(item.roles));
  const isReportsActive = pathname.startsWith("/reports");

  return (
    <aside className="w-60 min-h-screen bg-gray-900 text-white flex flex-col flex-shrink-0">
      {/* Brand */}
      <div className="px-6 py-5 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-sm font-bold">A</div>
          <div>
            <p className="text-sm font-bold leading-tight">Attendance</p>
            <p className="text-xs text-gray-400">Portal v1.1.0</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.filter(item => canSee(item.roles)).map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active ? "bg-blue-600 text-white font-semibold" : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}>
              <span className="text-base w-5 text-center">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}

        {/* Reports dropdown */}
        {visibleReports.length > 0 && (
          <div>
            <button
              onClick={() => setReportsOpen(v => !v)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isReportsActive ? "bg-blue-600/20 text-blue-300 font-semibold" : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <span className="text-base w-5 text-center">📈</span>
              <span className="flex-1 text-left">Reports</span>
              <span className="text-xs text-gray-500">{reportsOpen ? "▲" : "▼"}</span>
            </button>
            {reportsOpen && (
              <div className="ml-4 mt-0.5 space-y-0.5 border-l border-gray-700 pl-3">
                {visibleReports.map(item => {
                  const active = pathname === item.href;
                  return (
                    <Link key={item.href} href={item.href}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        active ? "bg-blue-600 text-white font-semibold" : "text-gray-400 hover:bg-gray-800 hover:text-white"
                      }`}>
                      <span className="text-sm w-4 text-center">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* User */}
      <div className="px-4 py-4 border-t border-gray-700">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{profile?.name ?? profile?.email}</p>
            <p className="text-xs text-gray-400">{roleLabel}</p>
          </div>
        </div>
        <button onClick={signOut}
          className="w-full text-left text-xs text-gray-400 hover:text-red-400 transition-colors py-1 px-1">
          Sign out →
        </button>
      </div>
    </aside>
  );
}

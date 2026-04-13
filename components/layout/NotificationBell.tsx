"use client";
import { useEffect, useRef, useState } from "react";
import { collection, getDocs, query, where, orderBy, limit, updateDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

interface Notif { id:string; title:string; body:string; read:boolean; timestamp?:any; type?:string; fromName?:string; }

const fmtTs = (ts:any) => {
  if(!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
};

export default function NotificationBell() {
  const { user } = useAuth();
  const [notifs, setNotifs]   = useState<Notif[]>([]);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const panelRef              = useRef<HTMLDivElement>(null);

  const unread = notifs.filter(n=>!n.read).length;

  useEffect(() => { if(user) loadNotifs(); }, [user]);

  // Close on outside click
  useEffect(() => {
    const handler = (e:MouseEvent) => {
      if(panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const loadNotifs = async () => {
    if(!user) return;
    setLoading(true);
    try {
      const snap = await getDocs(query(
        collection(db,"notifications"),
        where("toUserId","==",user.uid),
        orderBy("timestamp","desc"),
        limit(30)
      ));
      // Also load broadcasts (toUserId == null)
      const broadSnap = await getDocs(query(
        collection(db,"notifications"),
        where("toUserId","==",null),
        orderBy("timestamp","desc"),
        limit(10)
      ));
      const all = [
        ...snap.docs.map(d=>({id:d.id,...d.data()} as Notif)),
        ...broadSnap.docs.map(d=>({id:d.id,...d.data()} as Notif)),
      ].sort((a,b)=>{
        const ta = a.timestamp?.toDate?.()?.getTime()??0;
        const tb = b.timestamp?.toDate?.()?.getTime()??0;
        return tb-ta;
      });
      setNotifs(all);
    } finally { setLoading(false); }
  };

  const markRead = async (id:string) => {
    await updateDoc(doc(db,"notifications",id), {read:true});
    setNotifs(prev=>prev.map(n=>n.id===id?{...n,read:true}:n));
  };

  const markAllRead = async () => {
    const unreadIds = notifs.filter(n=>!n.read).map(n=>n.id);
    await Promise.all(unreadIds.map(id=>updateDoc(doc(db,"notifications",id),{read:true})));
    setNotifs(prev=>prev.map(n=>({...n,read:true})));
  };

  const icon = (n:Notif) =>
    n.type==="holiday"?"🏖️":n.title?.includes("Device")?"📱":n.title?.includes("Approved")?"✅":n.title?.includes("Rejected")?"❌":"🔔";

  return (
    <div className="relative" ref={panelRef}>
      <button onClick={()=>{ setOpen(v=>!v); if(!open) loadNotifs(); }}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
        <span className="text-xl">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <p className="font-bold text-gray-800 text-sm">Notifications {unread>0&&<span className="text-blue-600">({unread} new)</span>}</p>
            {unread>0&&<button onClick={markAllRead} className="text-xs text-blue-600 hover:underline font-semibold">Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-gray-400 text-sm">Loading...</div>
            ) : notifs.length===0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">No notifications</div>
            ) : notifs.map(n=>(
              <button key={n.id} onClick={()=>markRead(n.id)}
                className={`w-full text-left flex gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${!n.read?"bg-blue-50/50":""}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm ${!n.read?"bg-blue-600":"bg-gray-100"}`}>
                  {icon(n)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs ${!n.read?"font-bold text-gray-900":"font-medium text-gray-700"}`}>{n.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                  <p className="text-xs text-gray-300 mt-1">{fmtTs(n.timestamp)}</p>
                </div>
                {!n.read&&<div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1"/>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

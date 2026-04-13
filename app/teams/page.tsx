"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, doc, updateDoc, addDoc, serverTimestamp, arrayUnion, arrayRemove, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Modal from "@/components/ui/Modal";

interface Team { id:string; name:string; siteId?:string; siteName?:string; managerIds:string[]; memberIds:string[]; active:boolean; }
interface UserRecord { id:string; email:string; name?:string; role:string|string[]; department?:string; }

function TeamCard({ team, allUsers, onRefresh }: { team:Team; allUsers:UserRecord[]; onRefresh:()=>void }) {
  const [expanded, setExpanded] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [selectedUser, setSelectedUser] = useState("");
  const [saving, setSaving] = useState(false);

  const managers = team.managerIds.map(id => allUsers.find(u => u.id === id)).filter(Boolean) as UserRecord[];
  const members  = team.memberIds.map(id => allUsers.find(u => u.id === id)).filter(Boolean) as UserRecord[];
  const available = allUsers.filter(u => !team.memberIds.includes(u.id));

  const handleAddMember = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      await updateDoc(doc(db,"teams",team.id), { memberIds: arrayUnion(selectedUser) });
      await updateDoc(doc(db,"users",selectedUser), { teamId: team.id });
      setSelectedUser(""); setAddingMember(false); onRefresh();
    } catch(e:any) { alert(e.message); } finally { setSaving(false); }
  };

  const handleRemoveMember = async (uid:string) => {
    if (!confirm("Remove this member?")) return;
    await updateDoc(doc(db,"teams",team.id), { memberIds: arrayRemove(uid) });
    onRefresh();
  };

  const handleDeactivate = async () => {
    if (!confirm(`Deactivate "${team.name}"?`)) return;
    await updateDoc(doc(db,"teams",team.id), { active: false });
    onRefresh();
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button onClick={() => setExpanded(v => !v)} className="w-full flex items-center gap-4 p-5 text-left hover:bg-gray-50 transition-colors">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0">{team.name[0].toUpperCase()}</div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800">{team.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">{members.length} members · {managers.length} managers{team.siteName ? ` · ${team.siteName}` : ""}</p>
        </div>
        <span className="text-gray-400 text-lg">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-gray-100">
          <div className="mt-4 mb-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Managers</p>
            <div className="flex flex-wrap gap-2">
              {managers.length === 0 ? <p className="text-sm text-gray-400">None assigned</p>
                : managers.map(m => <span key={m.id} className="bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full">{m.name ?? m.email}</span>)}
            </div>
          </div>
          <div className="mb-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Members</p>
            <div className="flex flex-wrap gap-2">
              {members.length === 0 ? <p className="text-sm text-gray-400">No members yet</p>
                : members.map(m => (
                  <div key={m.id} className="flex items-center gap-1 bg-gray-100 rounded-full px-3 py-1">
                    <span className="text-xs text-gray-700 font-medium">{m.name ?? m.email}</span>
                    <button onClick={() => handleRemoveMember(m.id)} className="text-gray-400 hover:text-red-500 ml-1 font-bold text-sm">×</button>
                  </div>
                ))}
            </div>
          </div>
          {addingMember ? (
            <div className="flex gap-2">
              <select value={selectedUser} onChange={e => setSelectedUser(e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select employee...</option>
                {available.map(u => <option key={u.id} value={u.id}>{u.name ?? u.email}{u.department ? ` (${u.department})` : ""}</option>)}
              </select>
              <button onClick={handleAddMember} disabled={!selectedUser || saving} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300">{saving ? "..." : "Add"}</button>
              <button onClick={() => setAddingMember(false)} className="border border-gray-200 text-gray-500 px-4 py-2 rounded-xl text-sm hover:bg-gray-50">Cancel</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setAddingMember(true)} className="bg-blue-50 text-blue-600 border border-blue-200 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-100">+ Add Member</button>
              <button onClick={handleDeactivate} className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-red-100">Deactivate</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateTeamModal({ allUsers, onClose, onCreate }: { allUsers:UserRecord[]; onClose:()=>void; onCreate:()=>void }) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [selManagers, setManagers] = useState<string[]>([]);
  const [selMembers, setMembers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const managers = allUsers.filter(u => {
    const r = Array.isArray(u.role) ? u.role : (u.role ?? "").split(",").map((x:string) => x.trim());
    return r.some((x:string) => ["manager","admin"].includes(x));
  });

  const toggle = (uid:string, list:string[], setList:(v:string[])=>void) =>
    setList(list.includes(uid) ? list.filter(x => x !== uid) : [...list, uid]);

  const handleCreate = async () => {
    if (!name.trim()) { setError("Team name is required."); return; }
    if (!selManagers.length) { setError("Select at least one manager."); return; }
    setSaving(true); setError("");
    try {
      await addDoc(collection(db,"teams"), { name:name.trim(), managerIds:selManagers, memberIds:selMembers, active:true, createdBy:user?.uid, createdAt:serverTimestamp() });
      onCreate(); onClose();
    } catch(e:any) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal title="Create Team" onClose={onClose} maxWidth="max-w-lg">
      <div className="p-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Team Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sales - Multan"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-2">Managers *</label>
            <div className="max-h-36 overflow-y-auto space-y-1 border border-gray-100 rounded-xl p-2">
              {managers.length === 0 ? <p className="text-sm text-gray-400 px-3 py-2">No managers found. Set role to manager in Users first.</p>
                : managers.map(u => (
                  <button key={u.id} onClick={() => toggle(u.id, selManagers, setManagers)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm flex justify-between transition-colors ${selManagers.includes(u.id) ? "bg-blue-50 text-blue-700 font-semibold" : "hover:bg-gray-50 text-gray-700"}`}>
                    <span>{u.name ?? u.email}</span>
                    {selManagers.includes(u.id) && <span>✓</span>}
                  </button>
                ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-2">Members (optional)</label>
            <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-100 rounded-xl p-2">
              {allUsers.map(u => (
                <button key={u.id} onClick={() => toggle(u.id, selMembers, setMembers)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm flex justify-between transition-colors ${selMembers.includes(u.id) ? "bg-green-50 text-green-700 font-semibold" : "hover:bg-gray-50 text-gray-700"}`}>
                  <span>{u.name ?? u.email}{u.department ? ` (${u.department})` : ""}</span>
                  {selMembers.includes(u.id) && <span className="text-green-600">✓</span>}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50">Cancel</button>
            <button onClick={handleCreate} disabled={saving} className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300">{saving ? "Creating..." : "Create Team"}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function TeamsPage() {
  const { isAdmin, isManager } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [allUsers, setAllUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [teamsSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db,"teams"), where("active","==",true))),
        getDocs(collection(db,"users")),
      ]);
      setTeams(teamsSnap.docs.map(d => ({ id:d.id, ...d.data() } as Team)));
      setAllUsers(usersSnap.docs.map(d => ({ id:d.id, ...d.data() } as UserRecord)));
    } finally { setLoading(false); }
  };

  if (!isAdmin && !isManager) return <div className="p-8 text-center text-gray-400">Access required.</div>;

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Teams</h1>
          <p className="text-gray-500 text-sm mt-1">{teams.length} active team{teams.length !== 1 ? "s" : ""}</p>
        </div>
        {isAdmin && <button onClick={() => setShowCreate(true)} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">+ New Team</button>}
      </div>
      {loading ? (
        <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="bg-white rounded-2xl border border-gray-100 h-20 animate-pulse" />)}</div>
      ) : teams.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><p className="text-4xl mb-3">👥</p><p className="text-sm">No teams yet.</p></div>
      ) : (
        <div className="space-y-4">{teams.map(t => <TeamCard key={t.id} team={t} allUsers={allUsers} onRefresh={loadData} />)}</div>
      )}
      {showCreate && <CreateTeamModal allUsers={allUsers} onClose={() => setShowCreate(false)} onCreate={loadData} />}
    </div>
  );
}

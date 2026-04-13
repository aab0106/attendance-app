"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut as firebaseSignOut, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useRouter } from "next/navigation";

interface Profile {
  id: string;
  email: string;
  name?: string;
  role: string | string[];
  department?: string;
}

interface AuthCtx {
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  isManager: boolean;
  isDirector: boolean;
  isHR: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

const hasRole = (profile: Profile | null, role: string): boolean => {
  if (!profile?.role) return false;
  if (Array.isArray(profile.role)) return profile.role.includes(role);
  return profile.role.split(",").map((r: string) => r.trim()).includes(role);
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) { setUser(null); setProfile(null); return; }
      setUser(firebaseUser);
      try {
        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        if (snap.exists()) {
          setProfile({ id: snap.id, email: firebaseUser.email!, ...snap.data() } as Profile);
        } else {
          setProfile({ id: firebaseUser.uid, email: firebaseUser.email!, role: "employee" });
        }
      } catch {
        setProfile({ id: firebaseUser.uid, email: firebaseUser.email!, role: "employee" });
      }
    });
    return unsub;
  }, []);

  const signOut = async () => { await firebaseSignOut(auth); router.push("/login"); };

  const isAdmin    = hasRole(profile, "admin");
  const isDirector = hasRole(profile, "director") || isAdmin;
  const isManager  = hasRole(profile, "manager") || isDirector;
  const isHR       = hasRole(profile, "hr") || isAdmin;

  return (
    <AuthContext.Provider value={{ user: user ?? null, profile, isAdmin, isDirector, isManager, isHR, loading: user === undefined, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
};

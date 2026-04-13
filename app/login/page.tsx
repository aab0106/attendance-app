"use client";
import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const { user } = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) {
        setError("No user record found. Contact your administrator.");
        await auth.signOut(); return;
      }
      const data = snap.data();
      const roles: string[] = Array.isArray(data.role)
        ? data.role
        : (data.role ?? "").split(",").map((r: string) => r.trim());
      if (!roles.some(r => ["admin","manager","hr"].includes(r))) {
        setError("You don't have portal access. Use the mobile app instead.");
        await auth.signOut(); return;
      }
      router.push("/dashboard");
    } catch (err: any) {
      const c = err.code;
      setError(
        c === "auth/user-not-found"       ? "No account found with this email." :
        c === "auth/wrong-password"        ? "Incorrect password." :
        c === "auth/invalid-credential"   ? "Invalid email or password." :
        c === "auth/too-many-requests"     ? "Too many attempts. Try again later." :
        c === "auth/network-request-failed"? "Network error. Check your connection." :
        "Login failed. Please try again."
      );
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-700 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/30">
            <span className="text-3xl">🏢</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Attendance Portal</h1>
          <p className="text-blue-200 mt-2 text-sm">Admin · Manager · HR Dashboard</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-bold text-gray-800 mb-1">Welcome back</h2>
          <p className="text-gray-500 text-sm mb-6">Sign in with your company account</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-1.5">Email address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com" required
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-1.5">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password" required
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-semibold rounded-xl py-3.5 transition-colors text-sm">
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <p className="text-center text-gray-400 text-xs mt-6">
            Portal access is restricted to admin, manager and HR roles only
          </p>
        </div>
      </div>
    </div>
  );
}

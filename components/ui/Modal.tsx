"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  title?: string;
}

export default function Modal({ onClose, children, maxWidth = "max-w-lg", title }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // Only render portal client-side (after hydration)
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const content = (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
        display:"flex", alignItems:"flex-start", justifyContent:"center",
        zIndex:9999, padding:"1rem", overflowY:"auto" }}
    >
      <div style={{ background:"#fff", borderRadius:"1rem", boxShadow:"0 20px 60px rgba(0,0,0,0.3)",
          width:"100%", maxWidth: maxWidth==="max-w-lg"?"512px":maxWidth==="max-w-xl"?"576px":maxWidth==="max-w-2xl"?"672px":"512px",
          margin:"2rem auto", position:"relative" }}
        onClick={e => e.stopPropagation()}>
        {title && (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
            padding:"1.5rem 1.5rem 1rem", borderBottom:"1px solid #f0f0f0" }}>
            <h2 style={{ fontSize:"1.125rem", fontWeight:700, color:"#1a1a1a", margin:0 }}>{title}</h2>
            <button onClick={onClose} style={{ background:"none", border:"none", fontSize:"1.5rem",
              color:"#9ca3af", cursor:"pointer", lineHeight:1, padding:"0.25rem", borderRadius:"0.5rem" }}>
              ×
            </button>
          </div>
        )}
        {!title && (
          <button onClick={onClose} style={{ position:"absolute", top:"1rem", right:"1rem",
            background:"none", border:"none", fontSize:"1.5rem", color:"#9ca3af",
            cursor:"pointer", zIndex:10, borderRadius:"0.5rem", padding:"0.25rem" }}>
            ×
          </button>
        )}
        {children}
      </div>
    </div>
  );

  // Don't render during SSR — prevents hydration mismatch
  if (!mounted) return null;
  return createPortal(content, document.body);
}

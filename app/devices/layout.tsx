import PortalLayout from "@/components/layout/PortalLayout";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <PortalLayout>{children}</PortalLayout>;
}

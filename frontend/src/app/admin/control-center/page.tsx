import AdminControlCenterClient from "./AdminControlCenterClient";

// Keep the admin surface request-time rendered so proxy/auth decisions and
// admin-only API state are never baked into a static HTML artifact.
export const dynamic = "force-dynamic";

export default function AdminControlCenterPage() {
  return <AdminControlCenterClient />;
}

import type { Metadata } from "next";

import AdminUsersClient from "./AdminUsersClient";

export const metadata: Metadata = {
  title: "Users & access — AlphaDesk Admin",
  description:
    "Approve applicants, provision dashboards, watch tenant telemetry, suspend or impersonate users.",
};

// Admin surface — render at request time so cookie-auth + admin-only
// API state are never baked into a static HTML artifact.
export const dynamic = "force-dynamic";

export default function AdminUsersPage() {
  return <AdminUsersClient />;
}

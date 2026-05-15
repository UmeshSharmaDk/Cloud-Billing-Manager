import { Router } from "express";
import { db, usersTable, businessesTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "./auth";

const router = Router();

router.get("/stats", requireAuth, requireAdmin, async (_req, res) => {
  const allUsers = await db.select().from(usersTable);
  const businesses = await db.select().from(businessesTable);
  const nonAdmins = allUsers.filter(u => u.role !== "admin");
  const activeUsers = nonAdmins.filter(u => u.isActive).length;
  const inactiveUsers = nonAdmins.filter(u => !u.isActive).length;
  const expiredSubscriptions = nonAdmins.filter(u => {
    if (!u.subscriptionEnd) return false;
    return new Date(u.subscriptionEnd) < new Date();
  }).length;
  const recentUsers = [...nonAdmins]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
    .map(u => ({
      id: u.id, name: u.name, email: u.email, role: u.role,
      isActive: u.isActive, subscriptionStatus: u.subscriptionStatus,
      subscriptionEnd: u.subscriptionEnd, businessId: u.businessId,
      createdAt: u.createdAt,
    }));
  return res.json({
    totalUsers: nonAdmins.length,
    activeUsers,
    inactiveUsers,
    expiredSubscriptions,
    totalBusinesses: businesses.length,
    recentUsers,
  });
});

export default router;

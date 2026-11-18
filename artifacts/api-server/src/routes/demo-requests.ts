import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { rootDb, demoRequestsTable } from "@workspace/db";
import { validateBody, validateParams } from "../middleware/validate";
import { DemoRequestBody, DemoRequestStatusBody, IdParam } from "../schemas";
import { registerIpLimiter } from "../middleware/rate-limit";
import { requireAuth, requireSuperadmin } from "./auth";
import { sendQuietly } from "../lib/mailer";
import { config } from "../lib/config";
import type { AuthedRequest, IdParams } from "../lib/http";

/**
 * "Book a free demo" from the public website. Saves the request and emails it
 * to the team; it never creates an account (there is no public sign-up).
 * A hidden `website` field catches form-filling bots: they get the same answer
 * and nothing is saved.
 */
const router = Router();
type Req = AuthedRequest<any, any, IdParams>;

const ACCEPTED = { message: "Thank you. We will call you within one working day to fix a time." } as const;

router.post("/", registerIpLimiter, validateBody(DemoRequestBody), async (req: Req, res) => {
  const { website, ...form } = req.body;
  if (website) return res.status(202).json(ACCEPTED);

  const [row] = await rootDb.insert(demoRequestsTable)
    .values({ ...form, email: form.email || null, sourceIp: req.ip ?? null })
    .returning();

  await sendQuietly({
    to: process.env["DEMO_REQUEST_TO"]?.trim() || config.mail.from,
    subject: `Demo request: ${row.name.replace(/[\r\n]+/g, " ")} (${row.businessType})`,
    text: [
      `Name: ${row.name}`,
      `Phone: ${row.phone}`,
      `Email: ${row.email ?? "-"}`,
      `City: ${row.city ?? "-"}`,
      `Business: ${row.businessType}`,
      `Clients or branches: ${row.clientCount ?? "-"}`,
      "",
      row.message ?? "",
      "",
      `All requests: ${config.appBaseUrl}/superadmin`,
    ].join("\n"),
  });
  return res.status(202).json(ACCEPTED);
});

router.get("/", requireAuth, requireSuperadmin, async (_req, res) => {
  const rows = await rootDb.select().from(demoRequestsTable).orderBy(desc(demoRequestsTable.createdAt)).limit(200);
  return res.json({ requests: rows });
});

router.patch("/:id", requireAuth, requireSuperadmin, validateParams(IdParam), validateBody(DemoRequestStatusBody), async (req: Req, res) => {
  const [row] = await rootDb.update(demoRequestsTable).set({ status: req.body.status })
    .where(eq(demoRequestsTable.id, req.validatedParams.id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(row);
});

export default router;

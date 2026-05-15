import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import adminRouter from "./admin";
import businessRouter from "./business";
import customersRouter from "./customers";
import vendorsRouter from "./vendors";
import productsRouter from "./products";
import invoicesRouter from "./invoices";
import purchasesRouter from "./purchases";
import paymentsRouter from "./payments";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/admin", adminRouter);
router.use("/business", businessRouter);
router.use("/customers", customersRouter);
router.use("/vendors", vendorsRouter);
router.use("/products", productsRouter);
router.use("/invoices", invoicesRouter);
router.use("/purchases", purchasesRouter);
router.use("/payments", paymentsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/reports", reportsRouter);

export default router;

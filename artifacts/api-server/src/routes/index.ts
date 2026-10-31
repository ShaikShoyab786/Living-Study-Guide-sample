import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import studyRouter from "./study";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(studyRouter);

export default router;

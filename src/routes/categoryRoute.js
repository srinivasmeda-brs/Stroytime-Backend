import express from "express";
import { checkToken } from "../middleware/authMiddleware.js";

import { getCategories } from "../controllers/categoryController.js";

const router = express.Router();
router.get("/", checkToken, getCategories);

export default router;

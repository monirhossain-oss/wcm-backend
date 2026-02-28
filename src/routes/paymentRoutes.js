import express from 'express';
import { createCheckoutSession, handleStripeWebhook } from '../controllers/PaymentController.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = express.Router();

router.post('/create-checkout-session', authMiddleware, createCheckoutSession);

router.post('/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

export default router;

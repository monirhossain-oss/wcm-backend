// src/routes/paymentRoutes.js
import express from 'express';
import { createCheckoutSession, generateInvoice, handleStripeWebhook, payWithWallet } from '../controllers/PaymentController.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = express.Router();

router.post('/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

router.post('/create-checkout-session', express.json(), authMiddleware, createCheckoutSession);

router.get('/creator/invoice/:id', authMiddleware, generateInvoice);

router.post('/pay-with-wallet', authMiddleware, payWithWallet);

export default router;

import express from 'express';
import {
  cancelPromotion,
  createCheckoutSession,
  generateInvoice,
  handleStripeWebhook,
  purchasePromotion,
} from '../controllers/PaymentController.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = express.Router();

router.post('/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

router.post('/create-checkout-session', express.json(), authMiddleware, createCheckoutSession);

router.post('/purchase-promotion', express.json(), authMiddleware, purchasePromotion);

router.post('/cancel-promotion', express.json(), authMiddleware, cancelPromotion);

router.get('/creator/invoice/:id', express.json(), authMiddleware, generateInvoice);

export default router;

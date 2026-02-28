import mongoose from 'mongoose';
import Stripe from 'stripe';
import Transaction from '../models/Transaction.js';
import Listing from '../models/Listing.js';
import { createInvoice } from '../utils/invoiceGenerator.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const createCheckoutSession = async (req, res) => {
  try {
    const { listingId, packageType, amount, currency, currentPath } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency || 'eur',
            product_data: { name: `${packageType.toUpperCase()} Package` },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}${currentPath || '/'}?success=true`,
      cancel_url: `${process.env.CLIENT_URL}${currentPath || '/'}?canceled=true`,
      metadata: {
        listingId,
        packageType,
        creatorId: req.user._id.toString(),
      },
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Webhook Error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { listingId, packageType, creatorId } = session.metadata;

    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    try {
      const amountPaid = session.amount_total / 100;
      const currency = session.currency;
      let fxRate = currency === 'usd' ? 0.92 : 1;
      const amountInEUR = amountPaid * fxRate;

      const [newTransaction] = await Transaction.create(
        [
          {
            creator: creatorId,
            listing: listingId,
            stripeSessionId: session.id,
            amountPaid,
            currency,
            fxRate,
            amountInEUR,
            packageType,
            status: 'completed',
            vatAmount: amountInEUR * 0.19,
            invoiceNumber: `INV-${Date.now()}`,
          },
        ],
        { session: dbSession }
      );

      const updateData = {};
      if (packageType === 'boost') {
        updateData.isPromoted = true;
        updateData['promotion.type'] = 'boost';
        updateData['promotion.level'] = 2;
        updateData['promotion.expiresAt'] = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      } else if (packageType === 'ppc') {
        updateData.isPromoted = true;
        updateData['promotion.type'] = 'ppc';
        updateData['promotion.level'] = 1;
        updateData['promotion.costPerClick'] = 0.1;
      }

      const listing = await Listing.findByIdAndUpdate(
        listingId,
        packageType === 'ppc'
          ? { ...updateData, $inc: { 'promotion.ppcBalance': amountInEUR } }
          : updateData,
        { session: dbSession, new: true }
      );

      await dbSession.commitTransaction();
      console.log(`✅ Transaction & Listing Updated Successfully`);

      createInvoice(newTransaction, listing);
    } catch (error) {
      await dbSession.abortTransaction();
      console.error('❌ Transaction Failed. Rolled back.', error);
    } finally {
      dbSession.endSession();
    }
  }

  res.json({ received: true });
};

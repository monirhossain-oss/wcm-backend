import mongoose from 'mongoose';
import Stripe from 'stripe';
import Transaction from '../models/Transaction.js';
import Listing from '../models/Listing.js';
import User from '../models/User.js';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const applyPromotionLogic = (listing) => {
  const boostAmt = Number(listing.promotion?.boost?.amountPaid) || 0;
  const ppcAmt = Number(listing.promotion?.ppc?.amountPaid) || 0;
  const viewsCount = Number(listing.views) || 0;
  const favCount = listing.favorites?.length || 0;

  listing.promotion.level = Math.floor(
    boostAmt * 1.5 + ppcAmt * 1.2 + viewsCount * 0.1 + favCount * 2
  );

  const hasActivePpc = listing.promotion?.ppc?.isActive && listing.promotion?.ppc?.ppcBalance > 0;
  const hasActiveBoost =
    listing.promotion?.boost?.isActive && listing.promotion?.boost?.expiresAt > new Date();

  listing.isPromoted = !!(hasActivePpc || hasActiveBoost);
  return listing;
};

export const createCheckoutSession = async (req, res) => {
  try {
    const { listingId, packageType, amount, currency, currentPath, days } = req.body;

    const listing = await Listing.findById(listingId);
    if (
      packageType === 'boost' &&
      listing?.promotion?.boost?.isActive &&
      listing?.promotion?.boost?.expiresAt > new Date()
    ) {
      return res.status(400).json({ message: 'This listing already has an active Viral Boost.' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency || 'eur',
            product_data: {
              name: `${packageType.toUpperCase()} Promotion`,
              description: packageType === 'boost' ? `Active for ${days} days` : `Add PPC Credits`,
            },
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
        days: (days || 0).toString(),
        creatorId: req.user._id.toString(),
      },
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    res.status(500).json({ message: 'Payment initialization failed.' });
  }
};

export const payWithWallet = async (req, res) => {
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();
  try {
    const { listingId, packageType, amount, days } = req.body;
    const userId = req.user._id;

    const listing = await Listing.findById(listingId).session(dbSession);
    if (!listing) throw new Error('Listing not found');

    if (
      packageType === 'boost' &&
      listing.promotion?.boost?.isActive &&
      listing.promotion?.boost?.expiresAt > new Date()
    ) {
      throw new Error('Listing already has an active Viral Boost.');
    }

    const user = await User.findById(userId).session(dbSession);
    if (!user || user.walletBalance < amount) throw new Error('Insufficient wallet balance.');

    user.walletBalance = Number((user.walletBalance - amount).toFixed(2));
    await user.save({ session: dbSession });

    await Transaction.create(
      [
        {
          creator: userId,
          listing: listingId,
          stripeSessionId: `WALLET-${Date.now()}`,
          amountPaid: Number(amount),
          currency: 'eur',
          packageType,
          status: 'completed',
          invoiceNumber: `INV-W-${Date.now()}`,
        },
      ],
      { session: dbSession }
    );

    if (packageType === 'boost') {
      listing.promotion.boost.isActive = true;
      listing.promotion.boost.amountPaid =
        (listing.promotion.boost.amountPaid || 0) + Number(amount);
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + parseInt(days));
      listing.promotion.boost.expiresAt = expiry;
    } else {
      listing.promotion.ppc.isActive = true;
      listing.promotion.ppc.ppcBalance = Number(
        ((listing.promotion.ppc.ppcBalance || 0) + Number(amount)).toFixed(2)
      );
      listing.promotion.ppc.amountPaid = (listing.promotion.ppc.amountPaid || 0) + Number(amount);
    }

    const updatedListing = applyPromotionLogic(listing);

    await updatedListing.save({ session: dbSession });

    await dbSession.commitTransaction();
    res.status(200).json({ success: true, message: 'Promotion activated!' });
  } catch (error) {
    await dbSession.abortTransaction();
    res.status(400).json({ message: error.message });
  } finally {
    dbSession.endSession();
  }
};

export const handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { listingId, packageType, creatorId, days } = session.metadata;

    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();
    try {
      const amountPaid = session.amount_total / 100;
      const fxRate = session.currency === 'usd' ? 0.92 : 1;
      const amountInEUR = amountPaid * fxRate;

      await Transaction.create(
        [
          {
            creator: creatorId,
            listing: listingId,
            stripeSessionId: session.id,
            amountPaid,
            currency: session.currency,
            fxRate,
            amountInEUR,
            packageType,
            status: 'completed',
            invoiceNumber: `INV-${Date.now()}`,
          },
        ],
        { session: dbSession }
      );

      const listing = await Listing.findById(listingId).session(dbSession);
      if (!listing) throw new Error('Listing not found');

      if (packageType === 'boost') {
        listing.promotion.boost.isActive = true;
        listing.promotion.boost.amountPaid =
          (listing.promotion.boost.amountPaid || 0) + amountInEUR;
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + parseInt(days));
        listing.promotion.boost.expiresAt = expiry;
      } else if (packageType === 'ppc') {
        listing.promotion.ppc.isActive = true;
        listing.promotion.ppc.ppcBalance = Number(
          ((listing.promotion.ppc.ppcBalance || 0) + amountInEUR).toFixed(2)
        );
        listing.promotion.ppc.amountPaid = (listing.promotion.ppc.amountPaid || 0) + amountInEUR;
      }

      const updatedListing = applyPromotionLogic(listing);
      await updatedListing.save({ session: dbSession });

      await dbSession.commitTransaction();
    } catch (error) {
      await dbSession.abortTransaction();
      console.error('Webhook Logic Error:', error);
    } finally {
      dbSession.endSession();
    }
  }
  res.json({ received: true });
};

export const generateInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const transaction = await Transaction.findById(id)
      .populate('creator', 'firstName lastName email profile')
      .populate('listing', 'title');

    if (!transaction) return res.status(404).json({ message: 'Transaction record not found' });

    const doc = new jsPDF();
    const brandOrange = [249, 115, 22];

    // Header Design
    doc.setFillColor(...brandOrange);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.text('OFFICIAL RECEIPT', 14, 25);

    // Meta Info
    doc.setFontSize(10);
    doc.text(`Invoice: ${transaction.invoiceNumber}`, 140, 20);
    doc.text(`Date: ${new Date(transaction.createdAt).toLocaleDateString()}`, 140, 28);

    // Bill Details
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('BILL TO:', 14, 55);
    doc.setFont('helvetica', 'normal');
    doc.text(`${transaction.creator?.firstName} ${transaction.creator?.lastName}`, 14, 62);
    doc.text(transaction.creator?.email || '', 14, 68);

    // Table
    autoTable(doc, {
      startY: 80,
      head: [['Description', 'Type', 'Amount']],
      body: [
        [
          `Promotion for: ${transaction.listing?.title || 'Culture Asset'}`,
          transaction.packageType.toUpperCase(),
          `${transaction.currency.toUpperCase()} ${transaction.amountPaid.toFixed(2)}`,
        ],
      ],
      headStyles: { fillColor: brandOrange },
    });

    // Totals
    const finalY = doc.lastAutoTable.finalY + 15;
    doc.setFont('helvetica', 'bold');
    doc.text(
      `Total Paid: ${transaction.currency.toUpperCase()} ${transaction.amountPaid.toFixed(2)}`,
      140,
      finalY
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(doc.output('arraybuffer')));
  } catch (error) {
    res.status(500).json({ message: 'Invoice generation failed' });
  }
};

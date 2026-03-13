import mongoose from 'mongoose';
import Stripe from 'stripe';
import axios from 'axios';
import Transaction from '../models/Transaction.js';
import Listing from '../models/Listing.js';
import User from '../models/User.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { createAuditLog } from '../utils/logger.js';
import {
  resetBoost,
  resetPPC,
  applyPromotionLogic,
  checkAndCleanupExpiry,
} from '../utils/promotionHelper.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const getExchangeRate = async (fromCurrency, toCurrency) => {
  try {
    const from = fromCurrency.toLowerCase();
    const to = toCurrency.toLowerCase();
    if (from === to) return 1;

    const response = await axios.get(
      `https://v6.exchangerate-api.com/v6/${process.env.EXCHANGE_RATE_API_KEY}/pair/${from}/${to}`
    );
    return response.data?.conversion_rate || 1;
  } catch (error) {
    console.error('Exchange Rate Error:', error);
    return 1;
  }
};

export const createCheckoutSession = async (req, res) => {
  try {
    const { amount, currency } = req.body;

    if (!amount || amount < 5)
      return res.status(400).json({ message: 'Minimum top-up is 5 units.' });

    const paymentCurrency = (currency || 'eur').toLowerCase();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: paymentCurrency,
            product_data: {
              name: `Wallet Top-up: ${req.user.firstName}`,
              description: `Adding funds to your creator wallet`,
            },
            unit_amount: Math.round(Number(amount) * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}/creator/promotions?success=true`,
      cancel_url: `${process.env.CLIENT_URL}/creator/promotions?canceled=true`,
      metadata: {
        creatorId: req.user._id.toString(),
        type: 'wallet_topup',
        originalCurrency: paymentCurrency,
      },
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    res.status(500).json({ message: 'Stripe failed. Try again.' });
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
    const { creatorId, originalCurrency } = session.metadata;

    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    try {
      const amountPaid = session.amount_total / 100; // কাস্টমার যা পে করেছে [cite: 8]
      let walletCreditInEUR = 0;
      let finalVatAmount = 0;
      let appliedVatRate = 0;

      // ১. কারেন্সি ভিত্তিক ভ্যাট এবং কনভার্সন লজিক
      if (originalCurrency === 'eur') {
        // EUR পেমেন্ট হলে কোনো ভ্যাট নেই
        walletCreditInEUR = amountPaid;
        appliedVatRate = 0;
        finalVatAmount = 0;
      } else {
        // অন্য কারেন্সি (যেমন USD) হলে এক্সচেঞ্জ রেট এবং ভ্যাট ক্যালকুলেশন [cite: 8, 9]
        const fxRate = await getExchangeRate(originalCurrency, 'EUR');

        // আপনার আগের লজিক অনুযায়ী ভ্যাট ক্যালকুলেশন (যদি USD তে ভ্যাট রাখতে চান) [cite: 8]
        // যদি USD তেও ভ্যাট না চান তবে VAT_PERCENT = 0 করে দিন
        const VAT_PERCENT = Number(process.env.GLOBAL_VAT_RATE) || 0;
        const divisor = 1 + VAT_PERCENT / 100;

        const amountWithoutVat = amountPaid / divisor;
        finalVatAmount = Number((amountPaid - amountWithoutVat).toFixed(2));

        // EUR এ কনভার্ট করে ওয়ালেটে ক্রেডিট
        walletCreditInEUR = Number((amountWithoutVat * fxRate).toFixed(2));
      }

      // ২. ইউজারের ওয়ালেট আপডেট
      const updatedUser = await User.findByIdAndUpdate(
        creatorId,
        { $inc: { walletBalance: walletCreditInEUR } },
        { session: dbSession, new: true }
      );

      // ৩. ট্রানজেকশন রেকর্ড তৈরি [cite: 2, 8]
      const transaction = await Transaction.create(
        [
          {
            creator: creatorId,
            stripeSessionId: session.id,
            amountPaid,
            currency: originalCurrency.toUpperCase(),
            amountInEUR: walletCreditInEUR,
            packageType: 'wallet_topup',
            status: 'completed',
            vatRate: appliedVatRate,
            vatAmount: finalVatAmount,
            invoiceNumber: `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          },
        ],
        { session: dbSession }
      );

      // ৪. অডিট লগ তৈরি
      await createAuditLog({
        req,
        user: creatorId,
        action: 'WALLET_TOPUP_SUCCESS',
        targetType: 'Transaction',
        targetId: transaction[0]._id,
        details: {
          paidAmount: `${amountPaid} ${originalCurrency.toUpperCase()}`,
          creditedEUR: `${walletCreditInEUR} EUR`,
          newBalance: `${updatedUser.walletBalance} EUR`,
        },
      });

      await dbSession.commitTransaction();
      console.log(`Successfully credited ${walletCreditInEUR} EUR to: ${creatorId}`);
    } catch (error) {
      await dbSession.abortTransaction();
      console.error('Webhook processing failed:', error);
    } finally {
      dbSession.endSession();
    }
  }
  res.json({ received: true });
};

export const purchasePromotion = async (req, res) => {
  const { listingId, packageType, amountInEUR, days, totalClicks } = req.body;
  const userId = req.user._id;

  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const listing = await Listing.findById(listingId).session(dbSession);
    const user = await User.findById(userId).session(dbSession);

    // ১. এক্সপায়ারি ক্লিনআপ (যাতে পুরোনো ডাটা থাকলে রিসেট হয়ে যায়)
    checkAndCleanupExpiry(listing);

    // ২. ওভাররাইড প্রোটেকশন
    if (packageType === 'boost' && listing.promotion.boost.isActive) {
      throw new Error('Boost is already active. Wait for it to expire.');
    }
    if (packageType === 'ppc' && listing.promotion.ppc.isActive) {
      throw new Error('PPC balance still exists. Use it first.');
    }

    if (user.walletBalance < amountInEUR) throw new Error('Insufficient wallet balance.');

    // ৩. ওয়ালেট কাটাকাটি
    user.walletBalance = Number((user.walletBalance - amountInEUR).toFixed(2));
    await user.save({ session: dbSession });

    // ৪. নতুন প্যাকেজ সেট করা
    if (packageType === 'boost') {
      listing.promotion.boost.isActive = true;
      listing.promotion.boost.amountPaid = amountInEUR;
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + parseInt(days));
      listing.promotion.boost.expiresAt = expiry;
    } else if (packageType === 'ppc') {
      listing.promotion.ppc.isActive = true;
      listing.promotion.ppc.ppcBalance = amountInEUR;
      listing.promotion.ppc.amountPaid = amountInEUR;
      listing.promotion.ppc.totalClicks = parseInt(totalClicks);
      listing.promotion.ppc.costPerClick = Number((amountInEUR / totalClicks).toFixed(4));
    }

    // ৫. লেভেল ক্যালকুলেশন (এটি আগের প্যাকেজ থাকলেও দুটোর কম্বাইন্ড লেভেল বের করবে)
    applyPromotionLogic(listing);
    await listing.save({ session: dbSession });

    // ট্রানজেকশন এবং অডিট লগ আপনার আগের মতই থাকবে...
    await dbSession.commitTransaction();
    res.status(200).json({ success: true, newBalance: user.walletBalance });
  } catch (error) {
    await dbSession.abortTransaction();
    res.status(400).json({ success: false, message: error.message });
  } finally {
    dbSession.endSession();
  }
};

export const cancelPromotion = async (req, res) => {
  const { listingId, packageType } = req.body;
  const userId = req.user._id;

  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const listing = await Listing.findById(listingId).session(dbSession);
    const user = await User.findById(userId).session(dbSession);

    let refundAmount = 0;
    const now = new Date();

    if (packageType === 'boost' && listing.promotion.boost.isActive) {
      const expiry = new Date(listing.promotion.boost.expiresAt);
      if (expiry > now) {
        // ব্যবহৃত দিনের টাকা কেটে বাকিটা রিফান্ড (উদাহরণস্বরূপ ৩০ দিনের প্যাকেজ ধরলে)
        const totalPaid = listing.promotion.boost.amountPaid;
        const remainingTime = expiry.getTime() - now.getTime();
        const remainingDays = Math.max(0, remainingTime / (1000 * 60 * 60 * 24));
        refundAmount = Number(((totalPaid / 30) * remainingDays).toFixed(2));
      }
      resetBoost(listing); // বুস্ট ডাটা ক্লিয়ার
    } else if (packageType === 'ppc' && listing.promotion.ppc.isActive) {
      refundAmount = listing.promotion.ppc.ppcBalance; // পুরো কারেন্ট ব্যালেন্স রিফান্ড
      resetPPC(listing); // পিপিছি ডাটা ক্লিয়ার
    }

    // ওয়ালেটে রিফান্ড অ্যাড
    if (refundAmount > 0) {
      user.walletBalance = Number((user.walletBalance + refundAmount).toFixed(2));
      await user.save({ session: dbSession });
      // রিফান্ড ট্রানজেকশন ক্রিয়েট...
    }

    // লেভেল আপডেট (যদি অন্য কোনো প্যাকেজ অন থাকে সেটার স্কোর থাকবে, না থাকলে ০ হবে)
    applyPromotionLogic(listing);
    await listing.save({ session: dbSession });

    await dbSession.commitTransaction();
    res.status(200).json({ success: true, refundAmount });
  } catch (error) {
    await dbSession.abortTransaction();
    res.status(500).json({ message: error.message });
  } finally {
    dbSession.endSession();
  }
};

export const generateInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await Transaction.findById(id)
      .populate('creator', 'firstName lastName email profile role')
      .populate('listing', 'title');

    if (!transaction) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const isAdmin = req.user.role === 'admin';
    const isOwner = transaction.creator._id.toString() === req.user._id.toString();

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: 'Unauthorized access to this invoice' });
    }

    const doc = new jsPDF();
    const totalPaid = transaction.amountPaid;
    const vatAmount = transaction.vatAmount || 0;
    const currency = transaction.currency.toUpperCase();

    // --- সমস্যা এখানে ছিল: ম্যানুয়াল ক্যালকুলেশন বাদ দিয়ে ডাটাবেস থেকে রেট নিন ---
    // যদি ডাটাবেসে vatRate না থাকে তবেই কেবল ক্যালকুলেট করবে
    const netAmount = Number((totalPaid - vatAmount).toFixed(2));
    const vatRateDisplay = transaction.vatRate
      ? transaction.vatRate.toFixed(2)
      : netAmount > 0
        ? ((vatAmount / netAmount) * 100).toFixed(2)
        : '0.00';

    // --- Header Style (অপরিবর্তিত) ---
    doc.setFillColor(249, 115, 22);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('OFFICIAL INVOICE', 15, 25);
    doc.setFontSize(10);
    doc.text(process.env.BUSINESS_NAME || 'DRAKILO COLLECTIVE', 195, 25, { align: 'right' });

    // --- Details Section ---
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Invoice No:`, 15, 55);
    doc.setFont('helvetica', 'normal');
    doc.text(transaction.invoiceNumber || `INV-${transaction._id.toString().slice(-6)}`, 40, 55);

    const formattedDate = new Date(transaction.createdAt).toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    doc.text(`Date: ${formattedDate}`, 15, 62);

    doc.setFont('helvetica', 'bold');
    doc.text('Bill To:', 140, 55);
    doc.setFont('helvetica', 'normal');
    doc.text(`${transaction.creator.firstName} ${transaction.creator.lastName}`, 140, 62);
    doc.text(transaction.creator.email, 140, 68);

    // --- Table ---
    autoTable(doc, {
      startY: 80,
      head: [['Service Description', 'Net Price', 'VAT Amount', 'Total']],
      body: [
        [
          {
            content: `${transaction.packageType.replace('_', ' ').toUpperCase()}\n${transaction.listing?.title ? `Asset: ${transaction.listing.title}` : 'Wallet Top-up'}`,
            styles: { cellPadding: 5 },
          },
          `${netAmount.toFixed(2)} ${currency}`,
          `${vatAmount.toFixed(2)} (${vatRateDisplay}%)`,
          `${totalPaid.toFixed(2)} ${currency}`,
        ],
      ],
      headStyles: { fillColor: [30, 30, 30], fontStyle: 'bold' },
      styles: { fontSize: 9, valign: 'middle' },
      theme: 'grid',
    });

    const finalY = doc.lastAutoTable.finalY + 15;

    // --- Summary Section ---
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Grand Total:', 130, finalY);
    doc.text(`${totalPaid.toFixed(2)} ${currency}`, 195, finalY, { align: 'right' });

    // --- Exchange Rate Info ---
    if (currency !== 'EUR' && transaction.fxRate) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 100, 100);
      doc.text(`Exchange Rate: 1 ${currency} = ${transaction.fxRate} EUR`, 15, finalY + 10);
      doc.text(`Accounting Value: ${transaction.amountInEUR.toFixed(2)} EUR`, 15, finalY + 15);
    }

    // --- Footer ---
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('This is a computer-generated document by Drakilo Node System.', 105, 285, {
      align: 'center',
    });

    const pdfBuffer = doc.output('arraybuffer');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename=Invoice-${transaction.invoiceNumber}.pdf`
    );
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error('Invoice Gen Error:', err);
    res.status(500).json({ message: 'Error generating PDF invoice' });
  }
};

// import mongoose from 'mongoose';
// import Stripe from 'stripe';
// import axios from 'axios';
// import Transaction from '../models/Transaction.js';
// import Listing from '../models/Listing.js';
// import { jsPDF } from 'jspdf';
// import autoTable from 'jspdf-autotable';
// import { createAuditLog } from '../utils/logger.js';

// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// const getExchangeRate = async (fromCurrency, toCurrency) => {
//   try {
//     const from = fromCurrency.toLowerCase();
//     const to = toCurrency.toLowerCase();
//     if (from === to) return 1;

//     const response = await axios.get(
//       `https://v6.exchangerate-api.com/v6/${process.env.EXCHANGE_RATE_API_KEY}/pair/${from}/${to}`
//     );

//     if (response.data && response.data.conversion_rate) {
//       return response.data.conversion_rate;
//     }
//     return 1;
//   } catch (error) {
//     console.error('Exchange Rate Error:', error.message);
//     return 1;
//   }
// };

// export const createCheckoutSession = async (req, res) => {
//   try {
//     const { listingId, packageType, amount, currency, currentPath, days, totalClicks } = req.body;

//     const listing = await Listing.findById(listingId);
//     if (!listing) return res.status(404).json({ message: 'Listing not found' });

//     const now = new Date();

//     // --- প্রি-পেমেন্ট ভ্যালিডেশন (ডুপ্লিকেট প্রোমোশন চেক) ---
//     if (packageType === 'boost') {
//       // যদি অলরেডি একটিভ বুস্ট থাকে যার মেয়াদ শেষ হয়নি
//       if (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now) {
//         return res.status(400).json({
//           message: 'You already have an active Viral Boost for this listing.',
//         });
//       }
//     } else if (packageType === 'ppc') {
//       // যদি পিপিছি ব্যালেন্স এখনো থাকে
//       if (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) {
//         return res.status(400).json({
//           message: 'You already have an active PPC balance. Please wait for it to finish.',
//         });
//       }
//     }

//     const paymentCurrency = currency || 'eur';

//     // CPC ক্যালকুলেশন (এটি মেটাডাটায় যাবে)
//     const calculatedCPC =
//       packageType === 'ppc' ? (Number(amount) / Number(totalClicks)).toFixed(4) : '0';

//     // স্ট্রাইপ সেশন তৈরি
//     const session = await stripe.checkout.sessions.create({
//       payment_method_types: ['card'],
//       line_items: [
//         {
//           price_data: {
//             currency: paymentCurrency,
//             product_data: {
//               name: `${packageType.toUpperCase()} Promotion: ${listing.title}`,
//               description:
//                 packageType === 'boost'
//                   ? `${days} Days Viral Boost`
//                   : `${totalClicks} Clicks Credit`,
//             },
//             unit_amount: Math.round(Number(amount) * 100),
//           },
//           quantity: 1,
//         },
//       ],
//       mode: 'payment',
//       success_url: `${process.env.CLIENT_URL}${currentPath || '/'}?success=true`,
//       cancel_url: `${process.env.CLIENT_URL}${currentPath || '/'}?canceled=true`,
//       metadata: {
//         listingId,
//         packageType,
//         days: days ? days.toString() : '0',
//         totalClicks: totalClicks ? totalClicks.toString() : '0',
//         originalCpc: calculatedCPC,
//         creatorId: req.user._id.toString(),
//       },
//     });

//     res.status(200).json({ url: session.url });
//   } catch (error) {
//     console.error('Stripe Session Error:', error);
//     res.status(500).json({ message: 'Could not initiate payment. Please try again.' });
//   }
// };

// const applyPromotionLogic = (listing, daysInput = null) => {
//   let boostScore = 0;
//   let ppcScore = 0;
//   const now = new Date();

//   // ১. Boost Intensity (টাকা / দিন)
//   if (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now) {
//     const amount = listing.promotion.boost.amountPaid || 0;
//     const expiry = new Date(listing.promotion.boost.expiresAt);

//     let daysDiff = daysInput;
//     if (!daysDiff) {
//       const diffTime = Math.abs(expiry - now);
//       daysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
//     }

//     boostScore = (amount / daysDiff) * 10;
//   }

//   // ২. PPC Priority (High CPC = High Level)
//   if (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) {
//     const cpc = listing.promotion.ppc.costPerClick || 0.1;
//     const balance = listing.promotion.ppc.ppcBalance || 0;

//     // CPC কে ৩০০ গুণ গুরুত্ব দেওয়া হয়েছে
//     ppcScore = cpc * 300 + balance * 0.05;
//   }

//   // ৩. আপডেট
//   listing.promotion.level = Math.floor(boostScore + ppcScore);
//   listing.isPromoted = !!(
//     (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) ||
//     (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now)
//   );

//   if (!listing.isPromoted) listing.promotion.level = 0;

//   return listing;
// };

// export const handleStripeWebhook = async (req, res) => {
//   const sig = req.headers['stripe-signature'];
//   let event;

//   try {
//     event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
//   } catch (err) {
//     return res.status(400).send(`Webhook Error: ${err.message}`);
//   }

//   if (event.type === 'checkout.session.completed') {
//     const session = event.data.object;

//     // স্ট্রাইপ থেকে লাইন আইটেম এবং ট্যাক্স ডিটেইলস নিয়ে আসা
//     const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
//       expand: ['total_details.breakdown.taxes'],
//     });

//     const { listingId, packageType, creatorId, days, totalClicks, originalCpc } = session.metadata;

//     const dbSession = await mongoose.startSession();
//     dbSession.startTransaction();

//     try {
//       const listing = await Listing.findById(listingId).session(dbSession);
//       if (!listing) throw new Error('Listing not found');

//       // পেমেন্ট ডাটা প্রসেসিং
//       const amountPaid = session.amount_total / 100; // অরিজিনাল কারেন্সি (যেমন USD)
//       const paymentCurrency = session.currency.toUpperCase();
//       const targetCurrency = process.env.INTERNAL_CURRENCY || 'EUR';

//       // রিয়েল-টাইম এক্সচেঞ্জ রেট কল
//       const fxRate = await getExchangeRate(paymentCurrency, targetCurrency);
//       const amountInEUR = Number((amountPaid * fxRate).toFixed(2));

//       // --- রিয়েল ভ্যাট ক্যালকুলেশন ---
//       // স্ট্রাইপ যদি ট্যাক্স অটো-ক্যালকুলেট করে থাকে তবে সেটি নেবে,
//       // নাহলে পেমেন্ট গেটওয়ের স্ট্যান্ডার্ড হিসেবে অ্যামাউন্ট থেকে ক্যালকুলেট করবে।
//       let vatAmount = 0;
//       if (
//         expandedSession.total_details.breakdown &&
//         expandedSession.total_details.breakdown.taxes.length > 0
//       ) {
//         vatAmount = expandedSession.total_details.breakdown.taxes[0].amount / 100;
//       } else {
//         // যদি স্ট্রাইপ ট্যাক্স না পাঠায়, তবে ইন্টারনাল কারেন্সি রেট অনুযায়ী ভ্যাট বের করা (১৯% স্ট্যান্ডার্ড হিসেবে ধরে)
//         // কিন্তু এটি ডাটাবেসে সেভ হয়ে যাবে তাই ভবিষ্যতে রেট বদলালেও সমস্যা নেই।
//         vatAmount = Number((amountPaid - amountPaid / 1.19).toFixed(2));
//       }

//       // ট্রানজেকশন রেকর্ড (এখুনি ডাটা ফ্রিজ করে দেওয়া হচ্ছে)
//       const transaction = await Transaction.create(
//         [
//           {
//             creator: creatorId,
//             listing: listingId,
//             stripeSessionId: session.id,
//             amountPaid, // রিয়েল পেইড অ্যামাউন্ট (যেমন ১০০ USD)
//             currency: session.currency,
//             fxRate,
//             amountInEUR,
//             packageType,
//             status: 'completed',
//             invoiceNumber: `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
//             vatAmount, // রিয়েল ভ্যাট যা পেমেন্টের সময় কাটা হয়েছে
//           },
//         ],
//         { session: dbSession }
//       );

//       // --- ডাটা আপডেট লজিক ---
//       if (packageType === 'boost') {
//         listing.promotion.boost.isActive = true;
//         listing.promotion.boost.amountPaid = amountInEUR;
//         const expiry = new Date();
//         expiry.setDate(expiry.getDate() + parseInt(days));
//         listing.promotion.boost.expiresAt = expiry;
//       } else if (packageType === 'ppc') {
//         listing.promotion.ppc.isActive = true;
//         listing.promotion.ppc.ppcBalance = amountInEUR;
//         listing.promotion.ppc.amountPaid = amountInEUR;
//         listing.promotion.ppc.totalClicks = parseInt(totalClicks);
//         listing.promotion.ppc.executedClicks = 0;

//         const cpcInEUR = Number((Number(originalCpc) * fxRate).toFixed(4));
//         listing.promotion.ppc.costPerClick = cpcInEUR;
//       }

//       applyPromotionLogic(listing, parseInt(days) || null);
//       await listing.save({ session: dbSession });

//       await createAuditLog({
//         req,
//         user: creatorId, // সরাসরি পাস করা হলো
//         action: 'PROMOTION_PURCHASED',
//         targetType: 'Transaction',
//         targetId: transaction[0]._id,
//         details: {
//           listingTitle: listing.title,
//           packageType: packageType, // 'boost' or 'ppc'
//           amountPaid: `${amountPaid} ${paymentCurrency}`,
//           amountInEUR: `${amountInEUR} EUR`,
//           status: 'Success',
//           message: `Creator purchased ${packageType.toUpperCase()} for "${listing.title}"`,
//         },
//       });

//       await dbSession.commitTransaction();

//       console.log(`[Webhook] Success. Transaction saved with VAT: ${vatAmount}`);
//     } catch (error) {
//       await dbSession.abortTransaction();
//       console.error('❌ Webhook Logic Error:', error.message);
//     } finally {
//       dbSession.endSession();
//     }
//   }
//   res.json({ received: true });
// };

import mongoose from 'mongoose';
import Stripe from 'stripe';
import axios from 'axios';
import Transaction from '../models/Transaction.js';
import Listing from '../models/Listing.js';
import User from '../models/User.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { createAuditLog } from '../utils/logger.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Real-time Exchange Rate Helper ---
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
    return 1;
  }
};

// --- Helper: Apply Promotion Logic (Same as before) ---
const applyPromotionLogic = (listing, daysInput = null) => {
  let boostScore = 0;
  let ppcScore = 0;
  const now = new Date();

  if (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now) {
    const amount = listing.promotion.boost.amountPaid || 0;
    const expiry = new Date(listing.promotion.boost.expiresAt);
    let daysDiff = daysInput || Math.ceil(Math.abs(expiry - now) / (1000 * 60 * 60 * 24)) || 1;
    boostScore = (amount / daysDiff) * 10;
  }

  if (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) {
    const cpc = listing.promotion.ppc.costPerClick || 0.1;
    const balance = listing.promotion.ppc.ppcBalance || 0;
    ppcScore = cpc * 300 + balance * 0.05;
  }

  listing.promotion.level = Math.floor(boostScore + ppcScore);
  listing.isPromoted = !!(
    (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) ||
    (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now)
  );

  if (!listing.isPromoted) listing.promotion.level = 0;
  return listing;
};

// --- STEP 1: Create Stripe Session for Wallet Top-up ---
export const createCheckoutSession = async (req, res) => {
  try {
    const { amount, currency } = req.body; // শুধুমাত্র কত টাকা অ্যাড করবে

    if (!amount || amount < 5)
      return res.status(400).json({ message: 'Minimum top-up is 5 units.' });

    const paymentCurrency = currency || 'eur';

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
      success_url: `${process.env.CLIENT_URL}/dashboard/wallet?success=true`,
      cancel_url: `${process.env.CLIENT_URL}/dashboard/wallet?canceled=true`,
      metadata: {
        creatorId: req.user._id.toString(),
        type: 'wallet_topup',
      },
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    res.status(500).json({ message: 'Stripe failed. Try again.' });
  }
};

// --- STEP 2: Purchase Promotion from Wallet Balance ---
export const purchasePromotion = async (req, res) => {
  const { listingId, packageType, amountInEUR, days, totalClicks } = req.body;
  const userId = req.user._id;

  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const user = await User.findById(userId).session(dbSession);
    const listing = await Listing.findById(listingId).session(dbSession);

    if (!listing) throw new Error('Listing not found');
    if (user.walletBalance < amountInEUR) throw new Error('Insufficient wallet balance.');

    // --- ডুপ্লিকেট প্রোমোশন চেক ---
    const now = new Date();
    if (
      packageType === 'boost' &&
      listing.promotion.boost.isActive &&
      listing.promotion.boost.expiresAt > now
    ) {
      throw new Error('Boost already active.');
    }
    if (
      packageType === 'ppc' &&
      listing.promotion.ppc.isActive &&
      listing.promotion.ppc.ppcBalance > 0
    ) {
      throw new Error('PPC balance already exists.');
    }

    // ১. ওয়ালেট থেকে টাকা কাটা
    user.walletBalance = Number((user.walletBalance - amountInEUR).toFixed(2));
    await user.save({ session: dbSession });

    // ২. লিস্টিং আপডেট
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

    applyPromotionLogic(listing, parseInt(days) || null);
    await listing.save({ session: dbSession });

    // ৩. ইন্টারনাল ট্রানজেকশন লগ (ওয়ালেট পার্সেস)
    await Transaction.create(
      [
        {
          creator: userId,
          listing: listingId,
          amountPaid: amountInEUR,
          currency: 'EUR',
          packageType,
          status: 'completed',
          invoiceNumber: `INT-${Date.now()}`,
          vatAmount: 0, // ভ্যাট অলরেডি টপ-আপের সময় কাটা হয়েছে
        },
      ],
      { session: dbSession }
    );

    await dbSession.commitTransaction();
    res.status(200).json({ success: true, newBalance: user.walletBalance });
  } catch (error) {
    await dbSession.abortTransaction();
    res.status(400).json({ message: error.message });
  } finally {
    dbSession.endSession();
  }
};

// --- STEP 3: Handle Webhook (Top-up logic only) ---
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
    const { creatorId } = session.metadata;

    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    try {
      const amountPaid = session.amount_total / 100;
      const fxRate = await getExchangeRate(session.currency, 'EUR');
      const amountInEUR = Number((amountPaid * fxRate).toFixed(2));

      // ১৯% ভ্যাট ক্যালকুলেশন (টপ-আপের সময় একবারই কাটবে)
      const vatAmount = Number((amountPaid - amountPaid / 1.19).toFixed(2));

      // ১. ইউজারের ওয়ালেট আপডেট
      await User.findByIdAndUpdate(
        creatorId,
        {
          $inc: { walletBalance: amountInEUR },
        },
        { session: dbSession }
      );

      // ২. ইনভয়েস জেনারেট করার জন্য ট্রানজেকশন রেকর্ড
      await Transaction.create(
        [
          {
            creator: creatorId,
            stripeSessionId: session.id,
            amountPaid,
            currency: session.currency,
            fxRate,
            amountInEUR,
            packageType: 'wallet_topup',
            status: 'completed',
            vatAmount,
            invoiceNumber: `INV-${Date.now()}`,
          },
        ],
        { session: dbSession }
      );

      await dbSession.commitTransaction();
    } catch (error) {
      await dbSession.abortTransaction();
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
      .populate('creator', 'firstName lastName email profile role')
      .populate('listing', 'title');

    if (!transaction) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // --- Authorization Check ---
    // Admin can see all, Creator can only see their own
    const isAdmin = req.user.role === 'admin';
    const isOwner = transaction.creator._id.toString() === req.user._id.toString();

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: 'Unauthorized access to this invoice' });
    }

    const doc = new jsPDF();
    const totalPaid = transaction.amountPaid;
    const vatAmount = transaction.vatAmount || 0;
    const netAmount = totalPaid - vatAmount;
    const currency = transaction.currency.toUpperCase();

    // Calculate VAT percentage
    const vatRatePercent = netAmount > 0 ? ((vatAmount / netAmount) * 100).toFixed(2) : '0.00';

    // --- Header Style ---
    doc.setFillColor(249, 115, 22); // Orange Theme
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('OFFICIAL INVOICE', 15, 25);

    doc.setFontSize(10);
    doc.text(process.env.BUSINESS_NAME || 'YOUR BUSINESS NAME', 195, 25, { align: 'right' });

    // --- Details Section ---
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Invoice No:`, 15, 55);
    doc.setFont('helvetica', 'normal');
    doc.text(transaction.invoiceNumber || `INV-${transaction._id.toString().slice(-6)}`, 40, 55);

    // Added Date & Time
    const formattedDate = new Date(transaction.createdAt).toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    doc.text(`Date & Time: ${formattedDate}`, 15, 62);

    // Bill To
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
            content: `${transaction.packageType.toUpperCase()} Promotion\nAsset: ${transaction.listing?.title || 'N/A'}`,
            styles: { cellPadding: 5 },
          },
          `${netAmount.toFixed(2)} ${currency}`,
          `${vatAmount.toFixed(2)} (${vatRatePercent}%)`,
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
    doc.text('Total Amount Paid:', 130, finalY);
    doc.text(`${totalPaid.toFixed(2)} ${currency}`, 195, finalY, { align: 'right' });

    // --- Exchange Rate Info (If not EUR) ---
    if (currency !== 'EUR') {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 100, 100);
      doc.text(`Exchange Rate Info: 1 ${currency} = ${transaction.fxRate} EUR.`, 15, finalY + 10);
      doc.text(
        `Internal Accounting Total: ${transaction.amountInEUR.toFixed(2)} EUR`,
        15,
        finalY + 15
      );
    }

    // --- Footer ---
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('This is a computer-generated document. No signature is required.', 105, 285, {
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
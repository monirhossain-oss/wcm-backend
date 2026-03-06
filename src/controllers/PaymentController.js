import mongoose from 'mongoose';
import Stripe from 'stripe';
import axios from 'axios';
import Transaction from '../models/Transaction.js';
import Listing from '../models/Listing.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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

    if (response.data && response.data.conversion_rate) {
      return response.data.conversion_rate;
    }
    return 1;
  } catch (error) {
    console.error('Exchange Rate Error:', error.message);
    return 1;
  }
};

// --- Create Checkout Session ---
export const createCheckoutSession = async (req, res) => {
  try {
    const { listingId, packageType, amount, currency, currentPath, days, totalClicks } = req.body;

    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    const now = new Date();

    // --- প্রি-পেমেন্ট ভ্যালিডেশন (ডুপ্লিকেট প্রোমোশন চেক) ---
    if (packageType === 'boost') {
      // যদি অলরেডি একটিভ বুস্ট থাকে যার মেয়াদ শেষ হয়নি
      if (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now) {
        return res.status(400).json({
          message: 'You already have an active Viral Boost for this listing.',
        });
      }
    } else if (packageType === 'ppc') {
      // যদি পিপিছি ব্যালেন্স এখনো থাকে
      if (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) {
        return res.status(400).json({
          message: 'You already have an active PPC balance. Please wait for it to finish.',
        });
      }
    }

    const paymentCurrency = currency || 'eur';

    // CPC ক্যালকুলেশন (এটি মেটাডাটায় যাবে)
    const calculatedCPC =
      packageType === 'ppc' ? (Number(amount) / Number(totalClicks)).toFixed(4) : '0';

    // স্ট্রাইপ সেশন তৈরি
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: paymentCurrency,
            product_data: {
              name: `${packageType.toUpperCase()} Promotion: ${listing.title}`,
              description:
                packageType === 'boost'
                  ? `${days} Days Viral Boost`
                  : `${totalClicks} Clicks Credit`,
            },
            unit_amount: Math.round(Number(amount) * 100),
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
        days: days ? days.toString() : '0',
        totalClicks: totalClicks ? totalClicks.toString() : '0',
        originalCpc: calculatedCPC,
        creatorId: req.user._id.toString(),
      },
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Stripe Session Error:', error);
    res.status(500).json({ message: 'Could not initiate payment. Please try again.' });
  }
};

const applyPromotionLogic = (listing, daysInput = null) => {
  let boostScore = 0;
  let ppcScore = 0;
  const now = new Date();

  // ১. Boost Intensity (টাকা / দিন)
  if (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now) {
    const amount = listing.promotion.boost.amountPaid || 0;
    const expiry = new Date(listing.promotion.boost.expiresAt);

    let daysDiff = daysInput;
    if (!daysDiff) {
      const diffTime = Math.abs(expiry - now);
      daysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
    }

    boostScore = (amount / daysDiff) * 10;
  }

  // ২. PPC Priority (High CPC = High Level)
  if (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) {
    const cpc = listing.promotion.ppc.costPerClick || 0.1;
    const balance = listing.promotion.ppc.ppcBalance || 0;

    // CPC কে ৩০০ গুণ গুরুত্ব দেওয়া হয়েছে
    ppcScore = cpc * 300 + balance * 0.05;
  }

  // ৩. আপডেট
  listing.promotion.level = Math.floor(boostScore + ppcScore);
  listing.isPromoted = !!(
    (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) ||
    (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now)
  );

  if (!listing.isPromoted) listing.promotion.level = 0;

  return listing;
};

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
//     const { listingId, packageType, creatorId, days, totalClicks, originalCpc } = session.metadata;

//     const dbSession = await mongoose.startSession();
//     dbSession.startTransaction();

//     try {
//       const listing = await Listing.findById(listingId).session(dbSession);
//       if (!listing) throw new Error('Listing not found');

//       const now = new Date();

//       // --- ডুপ্লিকেট প্রমোশন চেক ---
//       if (packageType === 'boost') {
//         if (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now) {
//           throw new Error('Listing already has an active boost.');
//         }
//       } else if (packageType === 'ppc') {
//         if (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) {
//           throw new Error('Listing already has an active PPC campaign.');
//         }
//       }

//       // --- পেমেন্ট ডাটা প্রসেসিং ---
//       const amountPaid = session.amount_total / 100;
//       const paymentCurrency = session.currency.toUpperCase();
//       const targetCurrency = 'EUR';

//       const fxRate = await getExchangeRate(paymentCurrency, targetCurrency);
//       const amountInEUR = Number((amountPaid * fxRate).toFixed(2));

//       const vatRate = 19;
//       const vatAmountInEUR = Number((amountInEUR - amountInEUR / (1 + vatRate / 100)).toFixed(2));

//       // ট্রানজেকশন রেকর্ড
//       await Transaction.create(
//         [
//           {
//             creator: creatorId,
//             listing: listingId,
//             stripeSessionId: session.id,
//             amountPaid,
//             currency: session.currency,
//             fxRate,
//             amountInEUR,
//             packageType,
//             status: 'completed',
//             invoiceNumber: `INV-${Date.now()}`,
//             vatAmount: vatAmountInEUR,
//           },
//         ],
//         { session: dbSession }
//       );

//       // --- ডাটা আপডেট ---
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
//         listing.promotion.ppc.executedClicks = 0; // রিসেট

//         const cpcInEUR = Number((Number(originalCpc) * fxRate).toFixed(4));
//         listing.promotion.ppc.costPerClick = cpcInEUR;
//       }

//       // র‍্যাঙ্কিং লজিক কল (পাসিং days ইনপুট)
//       applyPromotionLogic(listing, parseInt(days) || null);

//       await listing.save({ session: dbSession });
//       await dbSession.commitTransaction();

//       console.log(`[Webhook] Success. Listing: ${listingId}, Level: ${listing.promotion.level}`);
//     } catch (error) {
//       await dbSession.abortTransaction();
//       console.error('❌ Webhook Logic Error:', error.message);
//       // এখানে আপনি চাইলে ইউজারকে রিফান্ড বা এরর লগ দিতে পারেন
//     } finally {
//       dbSession.endSession();
//     }
//   }
//   res.json({ received: true });
// };

// --- Generate Invoice ---

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

    // স্ট্রাইপ থেকে লাইন আইটেম এবং ট্যাক্স ডিটেইলস নিয়ে আসা
    const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['total_details.breakdown.taxes'],
    });

    const { listingId, packageType, creatorId, days, totalClicks, originalCpc } = session.metadata;

    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    try {
      const listing = await Listing.findById(listingId).session(dbSession);
      if (!listing) throw new Error('Listing not found');

      // পেমেন্ট ডাটা প্রসেসিং
      const amountPaid = session.amount_total / 100; // অরিজিনাল কারেন্সি (যেমন USD)
      const paymentCurrency = session.currency.toUpperCase();
      const targetCurrency = process.env.INTERNAL_CURRENCY || 'EUR';

      // রিয়েল-টাইম এক্সচেঞ্জ রেট কল
      const fxRate = await getExchangeRate(paymentCurrency, targetCurrency);
      const amountInEUR = Number((amountPaid * fxRate).toFixed(2));

      // --- রিয়েল ভ্যাট ক্যালকুলেশন ---
      // স্ট্রাইপ যদি ট্যাক্স অটো-ক্যালকুলেট করে থাকে তবে সেটি নেবে,
      // নাহলে পেমেন্ট গেটওয়ের স্ট্যান্ডার্ড হিসেবে অ্যামাউন্ট থেকে ক্যালকুলেট করবে।
      let vatAmount = 0;
      if (
        expandedSession.total_details.breakdown &&
        expandedSession.total_details.breakdown.taxes.length > 0
      ) {
        vatAmount = expandedSession.total_details.breakdown.taxes[0].amount / 100;
      } else {
        // যদি স্ট্রাইপ ট্যাক্স না পাঠায়, তবে ইন্টারনাল কারেন্সি রেট অনুযায়ী ভ্যাট বের করা (১৯% স্ট্যান্ডার্ড হিসেবে ধরে)
        // কিন্তু এটি ডাটাবেসে সেভ হয়ে যাবে তাই ভবিষ্যতে রেট বদলালেও সমস্যা নেই।
        vatAmount = Number((amountPaid - amountPaid / 1.19).toFixed(2));
      }

      // ট্রানজেকশন রেকর্ড (এখুনি ডাটা ফ্রিজ করে দেওয়া হচ্ছে)
      const transaction = await Transaction.create(
        [
          {
            creator: creatorId,
            listing: listingId,
            stripeSessionId: session.id,
            amountPaid, // রিয়েল পেইড অ্যামাউন্ট (যেমন ১০০ USD)
            currency: session.currency,
            fxRate,
            amountInEUR,
            packageType,
            status: 'completed',
            invoiceNumber: `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
            vatAmount, // রিয়েল ভ্যাট যা পেমেন্টের সময় কাটা হয়েছে
          },
        ],
        { session: dbSession }
      );

      // --- ডাটা আপডেট লজিক ---
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
        listing.promotion.ppc.executedClicks = 0;

        const cpcInEUR = Number((Number(originalCpc) * fxRate).toFixed(4));
        listing.promotion.ppc.costPerClick = cpcInEUR;
      }

      applyPromotionLogic(listing, parseInt(days) || null);

      await listing.save({ session: dbSession });
      await dbSession.commitTransaction();

      console.log(`[Webhook] Success. Transaction saved with VAT: ${vatAmount}`);
    } catch (error) {
      await dbSession.abortTransaction();
      console.error('❌ Webhook Logic Error:', error.message);
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

    if (!transaction) return res.status(404).json({ message: 'Invoice not found' });

    const doc = new jsPDF();
    const totalPaid = transaction.amountPaid;
    const vatAmount = transaction.vatAmount;
    const netAmount = totalPaid - vatAmount;

    // ভ্যাট রেট পারসেন্টেজ বের করা (যেমন: ১৯.০০%)
    const vatRatePercent = ((vatAmount / netAmount) * 100).toFixed(2);

    // --- Header ---
    doc.setFillColor(249, 115, 22);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text('OFFICIAL INVOICE', 15, 25);

    doc.setFontSize(10);
    doc.text(process.env.BUSINESS_NAME, 195, 25, { align: 'right' });

    // --- Details ---
    doc.setTextColor(40, 40, 40);
    doc.text(`Invoice No: ${transaction.invoiceNumber}`, 15, 55);
    doc.text(`Date: ${new Date(transaction.createdAt).toLocaleDateString()}`, 15, 62);

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
          `${transaction.packageType.toUpperCase()} Promotion - ${transaction.listing.title}`,
          `${netAmount.toFixed(2)} ${transaction.currency.toUpperCase()}`,
          `${vatAmount.toFixed(2)} (${vatRatePercent}%)`,
          `${totalPaid.toFixed(2)} ${transaction.currency.toUpperCase()}`,
        ],
      ],
      headStyles: { fillColor: [30, 30, 30] },
    });

    const finalY = doc.lastAutoTable.finalY + 15;

    // Summary
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Total Amount Paid:', 130, finalY);
    doc.text(`${totalPaid.toFixed(2)} ${transaction.currency.toUpperCase()}`, 195, finalY, {
      align: 'right',
    });

    // কারেন্সি কনভার্সন ফুটনোট
    if (transaction.currency.toLowerCase() !== 'eur') {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 100, 100);
      doc.text(
        `Note: Payment converted to EUR at rate 1 ${transaction.currency.toUpperCase()} = ${transaction.fxRate}. Total: ${transaction.amountInEUR.toFixed(2)} EUR`,
        15,
        finalY + 15
      );
    }

    const pdfBuffer = doc.output('arraybuffer');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename=Invoice-${transaction.invoiceNumber}.pdf`
    );
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    res.status(500).json({ message: 'Error generating PDF invoice' });
  }
};

// export const generateInvoice = async (req, res) => {
//   try {
//     const { id } = req.params;

//     // ডাটা পপুলেট করা
//     const transaction = await Transaction.findById(id)
//       .populate('creator', 'firstName lastName email profile')
//       .populate('listing', 'title');

//     if (!transaction) return res.status(404).json({ message: 'Invoice not found' });

//     const doc = new jsPDF();

//     // --- রিয়েল ডাটা ক্যালকুলেশন (Database থেকে) ---
//     const totalPaid = transaction.amountPaid; // স্ট্রাইপে যা পে করেছে
//     const vatAmount = transaction.vatAmount || 0; // ডাটাবেসে সেভ করা রিয়েল ভ্যাট (অরিজিনাল কারেন্সিতে)

//     // ভ্যাট পারসেন্টেজ বের করা (যদি ভবিষ্যতে রেট জানতে চান)
//     // Formula: (VAT / NetAmount) * 100
//     const netAmount = totalPaid - vatAmount;
//     const effectiveVatRate = ((vatAmount / netAmount) * 100).toFixed(0);

//     // --- PDF Header Design ---
//     doc.setFillColor(249, 115, 22); // Orange Theme
//     doc.rect(0, 0, 210, 40, 'F');

//     doc.setTextColor(255, 255, 255);
//     doc.setFontSize(24);
//     doc.setFont('helvetica', 'bold');
//     doc.text('INVOICE', 15, 25);

//     doc.setFontSize(10);
//     doc.setFont('helvetica', 'normal');
//     doc.text(process.env.BUSINESS_NAME || 'Platform Name', 195, 20, { align: 'right' });
//     doc.text(process.env.BUSINESS_ADDRESS || 'Business Address', 195, 25, { align: 'right' });
//     doc.text(`VAT ID: ${process.env.BUSINESS_VAT_NUMBER || 'VAT-123456'}`, 195, 30, {
//       align: 'right',
//     });

//     // --- Client & Invoice Info ---
//     doc.setTextColor(40, 40, 40);
//     doc.setFontSize(10);

//     doc.setFont('helvetica', 'bold');
//     doc.text('Invoice Details:', 15, 55);
//     doc.setFont('helvetica', 'normal');
//     doc.text(`Number: ${transaction.invoiceNumber}`, 15, 62);
//     doc.text(`Date: ${new Date(transaction.createdAt).toLocaleDateString()}`, 15, 68);
//     doc.text(`Transaction ID: ${transaction.stripeSessionId.slice(0, 15)}...`, 15, 74);

//     doc.setFont('helvetica', 'bold');
//     doc.text('Bill To:', 140, 55);
//     doc.setFont('helvetica', 'normal');
//     doc.text(`${transaction.creator.firstName} ${transaction.creator.lastName}`, 140, 62);
//     doc.text(transaction.creator.email, 140, 68);

//     // --- Items Table (রিয়েল ডাটা ব্যবহার করে) ---
//     autoTable(doc, {
//       startY: 85,
//       head: [['Description', 'Package', 'Net Price', 'VAT', 'Total']],
//       body: [
//         [
//           { content: `Promotion: ${transaction.listing.title}`, styles: { fontStyle: 'bold' } },
//           transaction.packageType.toUpperCase(),
//           `${netAmount.toFixed(2)} ${transaction.currency.toUpperCase()}`,
//           `${vatAmount.toFixed(2)} (${effectiveVatRate}%)`,
//           `${totalPaid.toFixed(2)} ${transaction.currency.toUpperCase()}`,
//         ],
//       ],
//       headStyles: { fillColor: [30, 30, 30], textColor: [255, 255, 255] },
//       theme: 'grid',
//     });

//     // --- Summary Calculations ---
//     const finalY = doc.lastAutoTable.finalY + 10;

//     doc.setFontSize(10);
//     doc.text('Subtotal (Excl. VAT):', 130, finalY);
//     doc.text(`${netAmount.toFixed(2)} ${transaction.currency.toUpperCase()}`, 195, finalY, {
//       align: 'right',
//     });

//     doc.text(`Tax / VAT (${effectiveVatRate}%):`, 130, finalY + 7);
//     doc.text(`${vatAmount.toFixed(2)} ${transaction.currency.toUpperCase()}`, 195, finalY + 7, {
//       align: 'right',
//     });

//     doc.setLineWidth(0.5);
//     doc.line(130, finalY + 11, 195, finalY + 11);

//     doc.setFontSize(12);
//     doc.setFont('helvetica', 'bold');
//     doc.text('Grand Total:', 130, finalY + 18);
//     doc.text(`${totalPaid.toFixed(2)} ${transaction.currency.toUpperCase()}`, 195, finalY + 18, {
//       align: 'right',
//     });

//     // --- Exchange Rate Info ---
//     if (transaction.currency.toLowerCase() !== 'eur') {
//       doc.setFontSize(8);
//       doc.setFont('helvetica', 'italic');
//       doc.setTextColor(120, 120, 120);
//       doc.text(
//         `Note: Paid in ${transaction.currency.toUpperCase()}. Equivalent value: ${transaction.amountInEUR.toFixed(2)} EUR (Rate: ${transaction.fxRate})`,
//         15,
//         finalY + 30
//       );
//     }

//     // --- Footer ---
//     doc.setFontSize(8);
//     doc.setTextColor(150, 150, 150);
//     doc.text('This is a computer-generated document. No signature is required.', 105, 285, {
//       align: 'center',
//     });

//     // Response
//     const pdfBuffer = doc.output('arraybuffer');
//     res.setHeader('Content-Type', 'application/pdf');
//     res.setHeader(
//       'Content-Disposition',
//       `inline; filename=Invoice-${transaction.invoiceNumber}.pdf`
//     );
//     res.send(Buffer.from(pdfBuffer));
//   } catch (err) {
//     console.error('Invoice Error:', err);
//     res.status(500).json({ message: 'Failed to generate invoice.' });
//   }
// };
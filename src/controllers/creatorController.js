import Listing from '../models/Listing.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import Analytics from '../models/Analytics.js';

export const getCreatorDashboardStats = async (req, res) => {
  try {
    const creatorId = req.user._id;

    const [user, listings, transactions] = await Promise.all([
      User.findById(creatorId).select('walletBalance'),
      Listing.find({ creatorId }),
      Transaction.find({ creator: creatorId, status: 'completed' }),
    ]);

    const totalSpent = transactions
      .reduce((acc, curr) => acc + (Number(curr.amountPaid) || 0), 0)
      .toFixed(2);

    const totalViews = listings.reduce((acc, curr) => acc + (curr.views || 0), 0);
    const totalPaidClicks = listings.reduce(
      (acc, curr) => acc + (curr.promotion?.ppc?.totalClicks || 0),
      0
    );
    const totalFavorites = listings.reduce((acc, curr) => acc + (curr.favorites?.length || 0), 0);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const analyticsData = await Analytics.find({
      creatorId,
      date: { $gte: sevenDaysAgo },
    });

    const chartData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);

      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });

      const dayRecord = analyticsData.find((a) => new Date(a.date).getTime() === d.getTime());

      chartData.push({
        name: dayName,
        views: dayRecord ? dayRecord.views : 0,
        clicks: dayRecord ? dayRecord.clicks : 0,
      });
    }

    const stats = {
      totalListings: listings.length,
      totalViews,
      totalPaidClicks,
      totalFavorites,
      activePromotions: listings.filter((l) => l.isPromoted).length,

      totalSpent,
      walletBalance: (Number(user?.walletBalance) || 0).toFixed(2),

      totalPpcBalance: listings
        .reduce((acc, curr) => acc + (curr.promotion?.ppc?.ppcBalance || 0), 0)
        .toFixed(2),

      statusCount: {
        approved: listings.filter((l) => l.status === 'approved').length,
        pending: listings.filter((l) => l.status === 'pending').length,
        rejected: listings.filter((l) => l.status === 'rejected').length,
      },

      chartData: chartData,
    };

    res.status(200).json(stats);
  } catch (error) {
    console.error('Dashboard Stats Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard stats',
      error: error.message,
    });
  }
};

export const getMyTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({ creator: req.user._id })
      .populate('listing', 'title image')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: transactions.length,
      transactions,
    });
  } catch (error) {
    console.error('Transaction Fetch Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
    });
  }
};

export const getPromotionAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const listing = await Listing.findOne({ _id: id, creatorId: userId })
      .select('title promotion views isPromoted image')
      .lean();

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    const ppc = listing.promotion?.ppc || {};
    const boost = listing.promotion?.boost || {};

    // --- PPC Calculation Logic ---
    const costPerClick = Number(ppc.costPerClick) || 0.1;
    const currentBalance = Number(ppc.ppcBalance) || 0;
    const clicksUsed = Number(ppc.totalClicks) || 0;

    // ১. মোট কত টাকার পিপিছি কেনা হয়েছিল (amountPaid) সেটা থেকে মোট ক্লিক সংখ্যা বের করা
    const amountPaid = Number(ppc.amountPaid) || 0;
    let totalPurchasedClicks = amountPaid > 0 ? Math.floor(amountPaid / costPerClick) : 0;

    // সেফটি চেক: যদি কোনো কারণে totalPurchasedClicks খরচ করা ক্লিকের চেয়ে কম দেখায় (পুরানো ডাটা হলে)
    if (totalPurchasedClicks < clicksUsed) {
      totalPurchasedClicks = clicksUsed + Math.floor(currentBalance / costPerClick);
    }

    // ২. কয়টা ক্লিক বাকি আছে
    const clicksRemaining = Math.max(0, Math.floor(currentBalance / costPerClick));

    // ৩. কনজাম্পশন রেট (শতকরা কতটুকু শেষ হয়েছে)
    const consumptionRate =
      totalPurchasedClicks > 0 ? Number(((clicksUsed / totalPurchasedClicks) * 100).toFixed(1)) : 0;

    // --- Boost Calculation ---
    let daysRemaining = 0;
    let boostProgress = 0;
    if (boost.isActive && boost.expiresAt) {
      const now = new Date();
      const expiry = new Date(boost.expiresAt);
      const diffTime = expiry - now;
      daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
      boostProgress = Number(Math.min(100, Math.max(0, (daysRemaining / 30) * 100)).toFixed(1));
    }

    res.status(200).json({
      success: true,
      data: {
        title: listing.title,
        image: listing.image,
        isPromoted: !!listing.isPromoted,
        level: listing.promotion?.level || 0,
        views: listing.views || 0,
        ppc: {
          isActive: !!(ppc.isActive && currentBalance >= costPerClick),
          balance: currentBalance.toFixed(2),
          costPerClick: costPerClick.toFixed(2),
          totalPurchasedClicks,
          clicksUsed,
          clicksRemaining,
          consumptionRate: Math.min(100, consumptionRate), // ১০০% এর বেশি হবে না
        },
        boost: {
          isActive: !!(boost.isActive && daysRemaining > 0),
          expiresAt: boost.expiresAt,
          daysRemaining,
          boostProgress,
        },
      },
    });
  } catch (error) {
    console.error('Analytics Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
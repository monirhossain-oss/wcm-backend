import Listing from '../models/Listing.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import Analytics from '../models/Analytics.js';

export const getMyTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 10, filter = 'all', search = '' } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    // ১. কোয়েরি ফিল্টার (শুধুমাত্র নিজের ট্রানজেকশন)
    let query = { creator: req.user._id, status: 'completed' };

    // ২. ডেট ফিল্টারিং
    const now = new Date();
    if (filter === 'today') {
      query.createdAt = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
    } else if (filter === 'month') {
      query.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), 1) };
    } else if (filter === 'year') {
      query.createdAt = { $gte: new Date(now.getFullYear(), 0, 1) };
    }

    // ৩. ইনভয়েস নম্বর দিয়ে সার্চ (যদি থাকে)
    if (search) {
      query.invoiceNumber = { $regex: search, $options: 'i' };
    }

    // ৪. ডাটা ফেচ করা
    const transactions = await Transaction.find(query)
      .populate('listing', 'title image')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(skip)
      .lean();

    const totalCount = await Transaction.countDocuments(query);

    res.status(200).json({
      success: true,
      transactions,
      pagination: {
        total: totalCount,
        page: Number(page),
        pages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error('Transaction Fetch Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message,
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

    if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });

    const ppc = listing.promotion?.ppc || {};
    const boost = listing.promotion?.boost || {};
    const now = new Date();

    // --- PPC Calculation ---
    const totalPurchased = Number(ppc.totalClicks) || 0;
    const executed = Number(ppc.executedClicks) || 0;
    const remaining = Math.max(0, totalPurchased - executed);
    const consumptionRate =
      totalPurchased > 0 ? Number(((executed / totalPurchased) * 100).toFixed(1)) : 0;

    // --- Boost Calculation (Real-time Focus) ---
    let daysRemaining = 0;
    let hoursRemaining = 0;
    let isExpiringSoon = false;

    if (boost.isActive && boost.expiresAt) {
      const expiry = new Date(boost.expiresAt);
      const diffMs = expiry - now;

      if (diffMs > 0) {
        daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        hoursRemaining = Math.floor(diffMs / (1000 * 60 * 60));
        // যদি ২৪ ঘণ্টার কম থাকে
        if (hoursRemaining < 24) isExpiringSoon = true;
      }
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
          isActive: !!(ppc.isActive && ppc.ppcBalance > 0),
          balance: Number(ppc.ppcBalance || 0).toFixed(2),
          costPerClick: Number(ppc.costPerClick || 0.1).toFixed(2),
          totalPurchased,
          clicksUsed: executed,
          clicksRemaining: remaining,
          consumptionRate: Math.min(100, consumptionRate),
        },
        boost: {
          isActive: !!(boost.isActive && hoursRemaining > 0),
          expiresAt: boost.expiresAt,
          daysRemaining,
          hoursRemaining,
          isExpiringSoon,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getCreatorDashboardStats = async (req, res) => {
  try {
    const creatorId = req.user._id;
    const now = new Date();
    // ফ্রন্টএন্ড থেকে ?refresh=true পাঠালে ক্যাশ ইগনোর করবে
    const isForceRefresh = req.query.refresh === 'true';

    // ১. ইউজার ডাটা আনা
    const user = await User.findById(creatorId).select('dashboardStats walletBalance');

    const lastUpdate = user?.dashboardStats?.lastUpdated
      ? new Date(user.dashboardStats.lastUpdated)
      : null;

    // ক্যাশ ভ্যালিডেশন (২৪ ঘণ্টা অথবা ফোর্স রিফ্রেশ না হওয়া পর্যন্ত)
    const isCacheExpired = !lastUpdate || now - lastUpdate > 24 * 60 * 60 * 1000;

    // ২. ক্যাশ রিটার্ন (যদি ফোর্স রিফ্রেশ না থাকে এবং ক্যাশ এক্সপায়ার না হয়)
    if (!isForceRefresh && !isCacheExpired && user?.dashboardStats?.data) {
      return res.status(200).json({
        success: true,
        stats: user.dashboardStats.data.stats,
        chartData: user.dashboardStats.data.chartData,
        walletBalance: user.walletBalance.toFixed(2), // লেটেস্ট ওয়ালেট ব্যালেন্স সবসময় পাঠাবে
        isCached: true,
        lastUpdated: lastUpdate,
      });
    }

    // ৩. নতুন ক্যালকুলেশন শুরু (Refresh Logic)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setHours(0, 0, 0, 0);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [listings, transactions, allAnalytics] = await Promise.all([
      Listing.find({ creatorId }),
      Transaction.find({
        creator: creatorId,
        status: 'completed',
        createdAt: { $gte: startOfMonth },
      }),
      Analytics.find({ creatorId }).lean(),
    ]);

    // অ্যানালিটিক্স ক্যালকুলেশন
    const lifetimeViews = allAnalytics.reduce((acc, curr) => acc + (curr.views || 0), 0);
    const lifetimeClicks = allAnalytics.reduce((acc, curr) => acc + (curr.clicks || 0), 0);

    // গ্রাফ ডাটা (৭ দিন)
    const chartData = [];
    for (let i = 0; i < 7; i++) {
      const targetDate = new Date(sevenDaysAgo);
      targetDate.setDate(targetDate.getDate() + i);
      const dateStr = targetDate.toISOString().split('T')[0];
      const dayData = allAnalytics.filter(
        (a) => new Date(a.date).toISOString().split('T')[0] === dateStr
      );
      chartData.push({
        name: targetDate.toLocaleDateString('en-US', { weekday: 'short' }),
        views: dayData.reduce((sum, d) => sum + (d.views || 0), 0),
        clicks: dayData.reduce((sum, d) => sum + (d.clicks || 0), 0),
      });
    }

    const totalMonthlySpend = transactions.reduce(
      (acc, curr) => acc + (Number(curr.amountPaid) || 0),
      0
    );

    const stats = {
      totalViews: lifetimeViews,
      totalMonthlySpend: totalMonthlySpend.toFixed(2),
      activeBoostsCount: listings.filter(
        (l) => l.promotion?.boost?.isActive && new Date(l.promotion.boost.expiresAt) > now
      ).length,
      activePpcCount: listings.filter(
        (l) => l.promotion?.ppc?.isActive && l.promotion.ppc.ppcBalance > 0
      ).length,
      totalActivePromoted: listings.filter(
        (l) =>
          (l.promotion?.boost?.isActive && new Date(l.promotion.boost.expiresAt) > now) ||
          (l.promotion?.ppc?.isActive && l.promotion.ppc.ppcBalance > 0)
      ).length,
      totalClicks: lifetimeClicks,
      totalListings: listings.length,
      statusCount: {
        approved: listings.filter((l) => l.status === 'approved').length,
        pending: listings.filter((l) => l.status === 'pending').length,
        rejected: listings.filter((l) => l.status === 'rejected').length,
      },
    };

    // ৪. ক্যাশ আপডেট (ডাটাবেসে সেভ)
    await User.findByIdAndUpdate(creatorId, {
      $set: {
        'dashboardStats.lastUpdated': now,
        'dashboardStats.data': { stats, chartData },
      },
    });

    res.status(200).json({
      success: true,
      stats,
      chartData,
      walletBalance: user.walletBalance.toFixed(2), // লেটেস্ট ব্যালেন্স
      isCached: false,
      lastUpdated: now,
    });
  } catch (error) {
    console.error('Stats Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

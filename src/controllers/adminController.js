import User from '../models/User.js';
import Listing from '../models/Listing.js';
import Category from '../models/Category.js';
import Tag from '../models/Tag.js';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import Transaction from '../models/Transaction.js';
import Analytics from '../models/Analytics.js';
import { SystemSettings } from '../models/SystemSettings.js';

export const createTag = async (req, res) => {
  try {
    const { title } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'Please upload a tag icon/image' });
    }

    const imageUrl = req.file.path;

    const newTag = await Tag.create({
      title,
      image: imageUrl,
    });

    res.status(201).json(newTag);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Tag title already exists' });
    }

    console.error('Tag Creation Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const createCategory = async (req, res) => {
  try {
    const count = await Category.countDocuments();
    const category = await Category.create({
      title: req.body.title,
      order: count,
    });
    res.status(201).json(category);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Category already exists' });
    }
    res.status(500).json({ message: error.message });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;
    const updatedCategory = await Category.findByIdAndUpdate(
      id,
      { title },
      { new: true, runValidators: true }
    );
    if (!updatedCategory) return res.status(404).json({ message: 'Category not found' });
    res.status(200).json(updatedCategory);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await Category.findByIdAndDelete(id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    res.status(200).json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateTag = async (req, res) => {
  try {
    const { id } = req.params;
    const tag = await Tag.findById(id);

    if (!tag) return res.status(404).json({ message: 'Tag not found' });

    let updateData = { title: req.body.title };

    if (req.file) {
      if (tag.image && !tag.image.startsWith('http')) {
        const oldImagePath = path.join(process.cwd(), tag.image);
        if (fs.existsSync(oldImagePath)) {
          try {
            fs.unlinkSync(oldImagePath);
          } catch (err) {
            console.error('Old local tag image delete failed:', err);
          }
        }
      }

      updateData.image = req.file.path;
    }

    const updatedTag = await Tag.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    res.status(200).json(updatedTag);
  } catch (error) {
    console.error('Update Tag Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const deleteTag = async (req, res) => {
  try {
    const { id } = req.params;
    const tag = await Tag.findById(id);

    if (!tag) return res.status(404).json({ message: 'Tag not found' });

    if (tag.image) {
      const relativePath = tag.image.startsWith('/') ? tag.image.slice(1) : tag.image;
      const imagePath = path.join(process.cwd(), relativePath);

      if (fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
        } catch (err) {
          console.error('File deletion error:', err.message);
        }
      }
    }

    await Tag.findByIdAndDelete(id);
    res.status(200).json({ message: 'Tag and image deleted successfully' });
  } catch (error) {
    console.error('Delete operation failed:', error);
    res.status(500).json({ message: 'Server error during deletion' });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getCreatorRequests = async (req, res) => {
  try {
    const requests = await User.find({
      'creatorRequest.isApplied': true,
      'creatorRequest.status': 'pending',
      role: 'user',
    }).select('-password');

    res.status(200).json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const approveCreator = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          role: 'creator',
          'creatorRequest.isApplied': false,
          'creatorRequest.status': 'approved',
          'creatorRequest.adminComment': 'Congratulations! Your creator account is approved.',
          'creatorRequest.rejectionReason': '',
        },
      },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found' });
    res.status(200).json({ message: 'User is now a Creator', user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const rejectCreator = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, statusType } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          'creatorRequest.isApplied': false,

          'creatorRequest.status': statusType || 'rejected',

          'creatorRequest.rejectionReason': reason || 'No specific reason provided.',

          'creatorRequest.adminComment':
            statusType === 'needs_review'
              ? 'Action required: Please update your profile as requested.'
              : 'Final Decision: Application Rejected.',
        },
      },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found' });

    res.status(200).json({
      message: `Creator request processed as ${statusType}`,
      user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ message: 'Cannot block an admin' });

    user.status = user.status === 'active' ? 'blocked' : 'active';
    await user.save();

    res.status(200).json({ message: `User is now ${user.status}`, status: user.status });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const manageListings = async (req, res) => {
  try {
    const listings = await Listing.find()
      .populate('creatorId', 'firstName lastName username email')
      .populate('category', 'title')
      .populate('culturalTags', 'title image')
      .sort({ createdAt: -1 })
      .lean();

    const now = new Date();

    const formattedListings = listings.map((item) => {
      // PPC Balance calculation
      const ppcBalance = item.promotion?.ppc?.isActive ? item.promotion.ppc.ppcBalance || 0 : 0;

      // Boost Remaining Time calculation
      let boostRemaining = 'No Active Boost';
      if (item.promotion?.boost?.isActive && item.promotion?.boost?.expiresAt) {
        const expiresAt = new Date(item.promotion.boost.expiresAt);
        if (expiresAt > now) {
          const diffMs = expiresAt - now;
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          boostRemaining = `${diffDays}d ${diffHours}h left`;
        } else {
          boostRemaining = 'Expired';
        }
      }

      return {
        ...item,
        creatorName: item.creatorId
          ? `${item.creatorId.firstName || ''} ${item.creatorId.lastName || ''}`.trim() ||
            item.creatorId.username
          : 'Unknown Creator',
        categoryName: item.category?.title || 'Uncategorized',
        ppcStatus: ppcBalance.toFixed(2),
        boostStatus: boostRemaining,
        isCurrentlyPromoted: item.isPromoted && (ppcBalance > 0 || boostRemaining.includes('left')),
      };
    });

    res.status(200).json(formattedListings);
  } catch (error) {
    console.error('Admin Manage Listings Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const deleteListingByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    await Listing.findByIdAndDelete(id);
    res.status(200).json({ message: 'Listing removed by admin' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateListingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    listing.status = status;
    if (status === 'rejected') {
      listing.rejectionReason = rejectionReason || 'Does not follow community guidelines.';
      listing.isPromoted = false;
    }

    await listing.save();
    res.status(200).json({ success: true, message: `Listing ${status} successfully.` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateCategoryOrder = async (req, res) => {
  try {
    const { categories } = req.body;

    const updatePromises = categories.map((cat, index) => {
      return Category.findByIdAndUpdate(cat._id, { order: index });
    });

    await Promise.all(updatePromises);

    res.status(200).json({ message: 'Order updated successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const exportUsersExcel = async (req, res) => {
  try {
    const userCursor = User.find({}).select('-password').cursor();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('System All Users');

    worksheet.columns = [
      { header: 'ID', key: '_id', width: 25 },
      { header: 'FULL NAME', key: 'fullName', width: 25 },
      { header: 'EMAIL', key: 'email', width: 30 },
      { header: 'USERNAME', key: 'username', width: 20 },
      { header: 'ROLE', key: 'role', width: 12 },
      { header: 'STATUS', key: 'status', width: 12 },
      { header: 'COUNTRY', key: 'country', width: 15 },
      { header: 'CREATOR STATUS', key: 'creatorStatus', width: 15 },
      { header: 'JOIN DATE', key: 'createdAt', width: 20 },
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEA580C' },
    };

    let count = 0;
    for (let user = await userCursor.next(); user != null; user = await userCursor.next()) {
      const profile = user.profile || {};
      const creatorRequest = user.creatorRequest || {};

      worksheet.addRow({
        _id: user._id.toString(),
        fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A',
        email: user.email || 'N/A',
        username: user.username || 'N/A',
        role: (user.role || 'user').toUpperCase(),
        status: (user.status || 'active').toUpperCase(),
        country: profile.country || 'N/A',
        creatorStatus: creatorRequest.isApplied
          ? (creatorRequest.status || 'pending').toUpperCase()
          : 'NO REQUEST',
        createdAt: user.createdAt ? user.createdAt.toISOString().split('T')[0] : 'N/A',
      });
      count++;
    }

    const fileName = `WCM_All_Users_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('EXPORT ERROR:', error);
    if (!res.headersSent) res.status(500).json({ message: 'Export failed' });
  }
};

export const exportTransactionsExcel = async (req, res) => {
  try {
    const transactionCursor = Transaction.find({})
      .populate('creator', 'firstName lastName email username')
      .populate('listing', 'title')
      .sort({ createdAt: -1 })
      .cursor();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payment Report');

    worksheet.columns = [
      { header: 'DATE', key: 'createdAt', width: 15 },
      { header: 'INVOICE NO', key: 'invoiceNumber', width: 20 },
      { header: 'CREATOR', key: 'creatorName', width: 25 },
      { header: 'LISTING', key: 'listingTitle', width: 30 },
      { header: 'PACKAGE', key: 'packageType', width: 12 },
      { header: 'CURRENCY', key: 'currency', width: 10 },
      { header: 'AMOUNT PAID', key: 'amountPaid', width: 15 },
      { header: 'FX RATE', key: 'fxRate', width: 10 },
      { header: 'EUR (INTERNAL)', key: 'amountInEUR', width: 15 },
      { header: 'VAT (19% EUR)', key: 'vatAmount', width: 15 },
      { header: 'STRIPE ID', key: 'stripeSessionId', width: 30 },
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEA580C' },
    };

    let count = 0;
    for (let tx = await transactionCursor.next(); tx != null; tx = await transactionCursor.next()) {
      worksheet.addRow({
        createdAt: tx.createdAt ? tx.createdAt.toISOString().split('T')[0] : 'N/A',
        invoiceNumber: tx.invoiceNumber || 'N/A',
        creatorName: tx.creator
          ? `${tx.creator.firstName || ''} ${tx.creator.lastName || ''}`.trim()
          : 'N/A',
        listingTitle: tx.listing ? tx.listing.title : 'Deleted Listing',
        packageType: (tx.packageType || '').toUpperCase(),
        currency: (tx.currency || '').toUpperCase(),
        amountPaid: tx.amountPaid,
        fxRate: tx.fxRate,
        amountInEUR: (tx.amountInEUR || 0).toFixed(2),
        vatAmount: (tx.vatAmount || 0).toFixed(2),
        stripeSessionId: tx.stripeSessionId,
      });
      count++;
    }

    const fileName = `Payment_Report_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('TRANSACTION EXPORT ERROR:', error);
    if (!res.headersSent) res.status(500).json({ message: 'Export failed' });
  }
};

export const getAllTransactions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      filter = 'all', // all, today, month, year
    } = req.query;

    let query = { status: 'completed' };

    // --- ১. ডেট ফিল্টারিং লজিক ---
    const now = new Date();
    if (filter === 'today') {
      const startOfToday = new Date(now.setHours(0, 0, 0, 0));
      query.createdAt = { $gte: startOfToday };
    } else if (filter === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      query.createdAt = { $gte: startOfMonth };
    } else if (filter === 'year') {
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      query.createdAt = { $gte: startOfYear };
    }

    // --- ২. গ্লোবাল সার্চ লজিক ---
    if (search) {
      // ইউজারের নাম বা ইমেইল দিয়ে সার্চ করার জন্য প্রথমে ইউজারদের খুঁজে বের করা
      const users = await User.find({
        $or: [
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { username: { $regex: search, $options: 'i' } },
        ],
      }).select('_id');

      const userIds = users.map((u) => u._id);

      // ট্রানজেকশন টেবিলে সার্চ (Invoice, Package Type বা User ID দিয়ে)
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { packageType: { $regex: search, $options: 'i' } },
        { stripeSessionId: { $regex: search, $options: 'i' } },
        { creator: { $in: userIds } },
      ];
    }

    const transactions = await Transaction.find(query)
      .populate('creator', 'firstName lastName email username')
      .populate('listing', 'title')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await Transaction.countDocuments(query);

    // --- ৩. ডাটা ফরম্যাটিং ---
    const formattedTransactions = transactions.map((tx) => {
      const netAmount = (tx.amountPaid || 0) - (tx.vatAmount || 0);

      return {
        _id: tx._id,
        userId: tx.creator?._id || 'N/A',
        creatorName: tx.creator ? `${tx.creator.firstName} ${tx.creator.lastName}` : 'Unknown',
        creatorEmail: tx.creator?.email,
        listingId: tx.listing?._id || 'N/A',
        listingTitle: tx.listing?.title || 'Deleted Listing',
        type: tx.packageType,
        amount: tx.amountPaid,
        currency: (tx.currency || 'EUR').toUpperCase(),
        netAmount: Number(netAmount.toFixed(2)),
        vatAmount: tx.vatAmount || 0,
        fxRate: tx.fxRate || 1,
        amountInEUR: tx.amountInEUR || 0,
        invoiceNumber: tx.invoiceNumber || 'N/A',
        stripeId: tx.stripeSessionId,
        createdAt: tx.createdAt,
      };
    });

    // সামারি স্ট্যাট (ঐচ্ছিক কিন্তু অ্যাডমিনের জন্য দরকারি)
    const totalRevenue = formattedTransactions.reduce((acc, curr) => acc + curr.amountInEUR, 0);

    res.status(200).json({
      success: true,
      transactions: formattedTransactions,
      pagination: {
        totalCount: count,
        totalPages: Math.ceil(count / limit),
        currentPage: Number(page),
      },
      stats: {
        totalEURInPage: Number(totalRevenue.toFixed(2)),
      },
    });
  } catch (error) {
    console.error('GetAllTransactions Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePpcBalanceManual = async (req, res) => {
  try {
    const { id } = req.params;
    const { amountToAdd } = req.body;

    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    const currentBalance = Number(listing.promotion?.ppc?.ppcBalance) || 0;
    const newBalance = currentBalance + Number(amountToAdd);

    listing.promotion.ppc.ppcBalance = newBalance;
    listing.promotion.ppc.isActive = newBalance > 0;
    listing.isPromoted = true;

    await listing.save();

    res.status(200).json({
      success: true,
      message: `Successfully added €${amountToAdd}. New balance: €${newBalance}`,
      newBalance,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getPromotedListings = async (req, res) => {
  try {
    const { search = '', type = 'all', page = 1, limit = 10 } = req.query;
    const now = new Date();

    // ফিল্টার কুয়েরি তৈরি
    let query = {
      $or: [
        { 'promotion.boost.isActive': true, 'promotion.boost.expiresAt': { $gt: now } },
        { 'promotion.ppc.isActive': true, 'promotion.ppc.ppcBalance': { $gt: 0 } },
      ],
    };

    // সার্চ লজিক (Title বা Creator Email দিয়ে)
    if (search) {
      query.$and = [
        {
          $or: [
            { title: { $regex: search, $options: 'i' } },
            { 'creatorId.email': { $regex: search, $options: 'i' } },
          ],
        },
      ];
    }

    // টাইপ ফিল্টার (Boost নাকি PPC)
    if (type === 'boost') {
      query = { 'promotion.boost.isActive': true, 'promotion.boost.expiresAt': { $gt: now } };
    } else if (type === 'ppc') {
      query = { 'promotion.ppc.isActive': true, 'promotion.ppc.ppcBalance': { $gt: 0 } };
    }

    const listings = await Listing.find(query)
      .populate('creatorId', 'firstName lastName email username')
      .sort({ 'promotion.level': -1 }) // সবচেয়ে বেশি টাকা খরচ করা লিস্টিং উপরে থাকবে
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await Listing.countDocuments(query);

    // প্রতিটি লিস্টিংয়ের জন্য লেটেস্ট ট্রানজেকশন/ইনভয়েস আইডি খুঁজে বের করা
    const formattedData = await Promise.all(
      listings.map(async (item) => {
        // এই লিস্টিংয়ের জন্য শেষ সফল পেমেন্টটি খুঁজে বের করা
        const lastTransaction = await Transaction.findOne({
          listing: item._id,
          status: 'completed',
        })
          .sort({ createdAt: -1 })
          .select('_id invoiceNumber');

        return {
          _id: item._id,
          title: item.title,
          creatorName: `${item.creatorId?.firstName} ${item.creatorId?.lastName}`,
          creatorEmail: item.creatorId?.email,
          boostStatus:
            item.promotion.boost.isActive && item.promotion.boost.expiresAt > now
              ? `Expires: ${new Date(item.promotion.boost.expiresAt).toLocaleDateString()}`
              : 'Inactive',
          ppcBalance: `€${item.promotion.ppc.ppcBalance.toFixed(2)}`,
          promotionLevel: item.promotion.level,
          invoiceId: lastTransaction ? lastTransaction._id : null, // ইনভয়েস ডাউনলোডের জন্য আইডি
          invoiceNo: lastTransaction ? lastTransaction.invoiceNumber : 'N/A',
        };
      })
    );

    res.status(200).json({
      success: true,
      listings: formattedData,
      totalCount: count,
      totalPages: Math.ceil(count / limit),
      currentPage: Number(page),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminStats = async (req, res) => {
  try {
    const now = new Date();
    const cacheKey = 'admin_global_stats';

    // ১. টাইম রেঞ্জ (গত ৭ দিন)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setHours(0, 0, 0, 0);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // ২. ডেটাবেস কল
    const [
      totalCreators,
      pendingListings,
      pendingRequests,
      recentPaymentsCount,
      allTransactions,
      allPromotedListings, 
      globalAnalytics,
    ] = await Promise.all([
      User.countDocuments({ role: 'creator' }),
      Listing.countDocuments({ status: 'pending' }),
      User.countDocuments({ 'creatorRequest.isApplied': true, 'creatorRequest.status': 'pending' }),
      Transaction.countDocuments({ status: 'completed', createdAt: { $gte: twentyFourHoursAgo } }),
      Transaction.find({ status: 'completed' }).lean(),
      Listing.find({ isPromoted: true }).lean(),
      Analytics.aggregate([
        { $group: { _id: null, totalViews: { $sum: '$views' }, totalClicks: { $sum: '$clicks' } } },
      ]),
    ]);

    // ৩. ফিন্যান্সিয়াল ক্যালকুলেশন
    let totalPaidRevenue = 0;
    let totalVat = 0;
    let netEarnedRevenue = 0; // আপনার নিশ্চিত ইনকাম (Non-refundable)
    let activePromotions = 0;

    // টোটাল রেভিনিউ এবং ভ্যাট (ট্রানজেকশন থেকে)
    allTransactions.forEach((t) => {
      totalPaidRevenue += Number(t.amountPaid) || 0;
      totalVat += Number(t.vatAmount) || 0;
    });

    // নিট রেভিনিউ ক্যালকুলেশন (লিস্টিং থেকে)
    allPromotedListings.forEach((l) => {
      // ৩.১ PPC থেকে ইনকাম (যতগুলো ক্লিক হয়ে গেছে)
      if (l.promotion?.ppc?.executedClicks > 0) {
        const usedPpc = l.promotion.ppc.executedClicks * (l.promotion.ppc.costPerClick || 0);
        netEarnedRevenue += usedPpc;
      }

      // ৩.২ Boost থেকে ইনকাম (যতটুকু সময় পার হয়ে গেছে)
      if (l.promotion?.boost?.isActive) {
        const boostData = l.promotion.boost;
        const createdAt = new Date(l.updatedAt); // বা যখন থেকে বুস্ট শুরু হয়েছে
        const expiresAt = new Date(boostData.expiresAt);
        const totalDuration = expiresAt - createdAt;
        const elapsed = now - createdAt;

        if (totalDuration > 0 && elapsed > 0) {
          const ratio = Math.min(1, elapsed / totalDuration); // ১ এর বেশি হবে না
          netEarnedRevenue += (boostData.amountPaid || 0) * ratio;
        }

        // একটিভ প্রোমোশন কাউন্ট (ভবিষ্যতে শেষ হবে এমন)
        if (expiresAt > now) activePromotions++;
      } else if (l.promotion?.ppc?.isActive && l.promotion.ppc.ppcBalance > 0) {
        activePromotions++;
      }
    });

    const stripeFees = totalPaidRevenue * 0.029 + allTransactions.length * 0.3;
    const netProfit = totalPaidRevenue - totalVat - stripeFees;

    // ৪. চার্ট ডেটা
    const dailyRevenueData = await Transaction.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$amountPaid' },
          vat: { $sum: '$vatAmount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const revenueFlow = dailyRevenueData.map((d) => {
      const dailyRev = d.revenue || 0;
      const dailyFee = dailyRev * 0.029 + d.count * 0.3;
      const dailyProfit = dailyRev - (d.vat || 0) - dailyFee;
      return {
        date: d._id,
        revenue: Number(dailyRev.toFixed(2)),
        profit: Number(Math.max(0, dailyProfit).toFixed(2)),
      };
    });

    // ৫. রেসপন্স অবজেক্ট
    const finalData = {
      cards: {
        totalRevenue: totalPaidRevenue.toFixed(2),
        netEarnedRevenue: netEarnedRevenue.toFixed(2), // আপনার নতুন ফিল্ড
        totalVat: totalVat.toFixed(2),
        stripeFees: stripeFees.toFixed(2),
        netProfit: netProfit.toFixed(2),
        totalViews: globalAnalytics[0]?.totalViews || 0,
        totalClicks: globalAnalytics[0]?.totalClicks || 0,
        activePromotions,
        recentPayments: recentPaymentsCount,
        pendingListings,
        pendingCreatorRequests: pendingRequests,
        totalCreators,
      },
      charts: {
        revenueFlow,
      },
    };

    // ৬. সিস্টেম সেটিংস এ সেভ (Cache)
    await SystemSettings.findOneAndUpdate(
      { key: cacheKey },
      { data: finalData, lastUpdated: now },
      { upsert: true }
    );

    res.status(200).json({ success: true, ...finalData });
  } catch (error) {
    console.error('Admin Stats Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
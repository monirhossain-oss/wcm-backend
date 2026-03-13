import AuditLog from '../models/AuditLog.js';

export const getCreatorAuditLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 15,
      search = '',
      filter = 'all', // all, today, month, year
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    // ১. শুধুমাত্র বর্তমান ইউজারের ডাটা ফিল্টার করা হবে
    let query = { user: req.user._id };

    // ২. ডেট ফিল্টারিং (Today, Month, Year)
    const now = new Date();
    if (filter === 'today') {
      query.createdAt = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
    } else if (filter === 'month') {
      query.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), 1) };
    } else if (filter === 'year') {
      query.createdAt = { $gte: new Date(now.getFullYear(), 0, 1) };
    }

    // ৩. সার্চ লজিক (Action বা Details এর ভেতর থেকে খোঁজা)
    if (search) {
      query.$or = [
        { action: { $regex: search, $options: 'i' } },
        { targetType: { $regex: search, $options: 'i' } },
        { 'details.listingTitle': { $regex: search, $options: 'i' } }, // যদি লিস্টিং নাম দিয়ে খুঁজতে চায়
        { 'details.packageType': { $regex: search, $options: 'i' } },
      ];
    }

    // ৪. ডাটা ফেচ করা
    const logs = await AuditLog.find(query)
      .populate({
        path: 'targetId',
        // refPath: 'targetType' অটোমেটিক কাজ করবে মডেলে ডিফাইন করা থাকলে
      })
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(skip)
      .lean();

    const total = await AuditLog.countDocuments(query);

    res.status(200).json({
      success: true,
      logs,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      },
      activeFilter: filter,
    });
  } catch (error) {
    console.error('Creator Audit Log Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminAuditLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      filter = 'all', // all, today, month, year
      actionType = '', // e.g., 'PAYMENT_COMPLETED', 'PPC_CLICK_DEDUCTION'
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const limitNum = Number(limit);

    // --- ১. ডাইনামিক ম্যাচ অবজেক্ট তৈরি ---
    let matchQuery = {};

    // ডেট ফিল্টারিং
    const now = new Date();
    if (filter === 'today') {
      matchQuery.createdAt = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
    } else if (filter === 'month') {
      matchQuery.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), 1) };
    } else if (filter === 'year') {
      matchQuery.createdAt = { $gte: new Date(now.getFullYear(), 0, 1) };
    }

    // স্পেসিফিক অ্যাকশন টাইপ ফিল্টার (যদি সিলেক্ট করা থাকে)
    if (actionType) {
      matchQuery.action = actionType;
    }

    // --- ২. পাইপলাইন অ্যাসেম্বল করা ---
    const pipeline = [
      { $match: matchQuery }, // শুরুতে ডেট ও অ্যাকশন ফিল্টার (Performance এর জন্য ভালো)
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      { $unwind: { path: '$userDetails', preserveNullAndEmptyArrays: true } },
      {
        // গ্লোবাল সার্চ (ইউজার নাম, ইমেইল, অ্যাকশন বা আইপি)
        $match: {
          $or: [
            { action: { $regex: search, $options: 'i' } },
            { targetType: { $regex: search, $options: 'i' } },
            { ipAddress: { $regex: search, $options: 'i' } },
            { 'userDetails.firstName': { $regex: search, $options: 'i' } }, // আপনার মডেলে firstName/lastName থাকলে
            { 'userDetails.lastName': { $regex: search, $options: 'i' } },
            { 'userDetails.email': { $regex: search, $options: 'i' } },
          ],
        },
      },
    ];

    // ৩. মোট রেকর্ড সংখ্যা বের করা
    const countResult = await AuditLog.aggregate([...pipeline, { $count: 'total' }]);
    const totalRecords = countResult.length > 0 ? countResult[0].total : 0;

    // ৪. ফাইনাল ডাটা এক্সট্রাকশন
    const logs = await AuditLog.aggregate([
      ...pipeline,
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
      {
        $project: {
          user: {
            _id: '$userDetails._id',
            name: { $concat: ['$userDetails.firstName', ' ', '$userDetails.lastName'] },
            email: '$userDetails.email',
            role: '$userDetails.role',
          },
          action: 1,
          targetType: 1,
          targetId: 1,
          details: 1,
          ipAddress: 1,
          createdAt: 1,
        },
      },
    ]);

    res.status(200).json({
      success: true,
      logs,
      pagination: {
        total: totalRecords,
        page: Number(page),
        pages: Math.ceil(totalRecords / limitNum),
      },
      currentFilters: { filter, actionType },
    });
  } catch (error) {
    console.error('Audit Log Search Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
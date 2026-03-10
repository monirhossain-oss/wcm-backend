import AuditLog from '../models/AuditLog.js';

export const getCreatorAuditLogs = async (req, res) => {
  try {
    const logs = await AuditLog.find({ user: req.user._id })
      .populate('targetId')
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const limitNum = Number(limit);

    // ১. পাইপলাইন তৈরি করছি যাতে ইউজার কালেকশন থেকে ডাটা লুকআপ করা যায়
    const aggregateQuery = [
      {
        // ইউজার কালেকশনের সাথে জয়েন (Left Outer Join)
        $lookup: {
          from: 'users', // ডাটাবেসে ইউজার কালেকশনের নাম (সাধারণত ছোট হাতের এবং প্লুরাল হয়)
          localField: 'user',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      { $unwind: { path: '$userDetails', preserveNullAndEmptyArrays: true } },
      {
        // সার্চ লজিক: অ্যাকশন, টার্গেট টাইপ, আইপি অথবা ইউজারের নাম/ইমেইল
        $match: {
          $or: [
            { action: { $regex: search, $options: 'i' } },
            { targetType: { $regex: search, $options: 'i' } },
            { ipAddress: { $regex: search, $options: 'i' } },
            { 'userDetails.name': { $regex: search, $options: 'i' } },
            { 'userDetails.email': { $regex: search, $options: 'i' } },
          ],
        },
      },
    ];

    // ২. মোট কতগুলো রেকর্ড আছে তা বের করা (প্যাজিনেশনের জন্য)
    const countResult = await AuditLog.aggregate([...aggregateQuery, { $count: 'total' }]);
    const totalRecords = countResult.length > 0 ? countResult[0].total : 0;

    // ৩. ফাইনাল ডাটা কুয়েরি (সর্টিং এবং প্যাজিনেশন সহ)
    const logs = await AuditLog.aggregate([
      ...aggregateQuery,
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
      {
        // ডাটা ফরম্যাট ঠিক করা যাতে ফ্রন্টএন্ডে আগের মতো দেখা যায়
        $project: {
          user: {
            _id: '$userDetails._id',
            name: '$userDetails.name',
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
    });
  } catch (error) {
    console.error('Audit Log Search Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
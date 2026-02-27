import User from '../models/User.js';
import Listing from '../models/Listing.js';
import Category from '../models/Category.js';
import Tag from '../models/Tag.js';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';

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

    const formattedListings = listings.map((item) => ({
      ...item,
      creatorName: item.creatorId
        ? `${item.creatorId.firstName || ''} ${item.creatorId.lastName || ''}`.trim() ||
          item.creatorId.username
        : 'Unknown Creator',
      favoritesCount: item.favorites?.length || 0,
      categoryName: item.category?.title || 'Uncategorized',
    }));

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

    let updateFields = { status };

    if (status === 'rejected') {
      updateFields.rejectionReason = rejectionReason || 'No reason provided';
    } else if (status === 'approved') {
      updateFields.rejectionReason = '';
    }

    const updatedListing = await Listing.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { returnDocument: 'after' }
    ).populate('creatorId', 'firstName lastName email');

    if (!updatedListing) return res.status(404).json({ message: 'Listing not found' });

    res.status(200).json({
      message: `Listing is now ${status}`,
      updatedListing,
    });
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

    console.log(`Exported ${count} users to Excel.`);

    const fileName = `WCM_All_Users_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    return res.status(200).end();
  } catch (error) {
    console.error('EXPORT ERROR:', error);
    if (!res.headersSent) res.status(500).send('Export failed');
  }
};

export const getAdminStats = async (req, res) => {
  try {
    const [totalUsers, totalListings, pendingRequests] = await Promise.all([
      User.countDocuments({ role: { $in: ['user', 'creator', 'admin'] } }),

      Listing.countDocuments(),
      User.countDocuments({ 'creatorRequest.status': 'pending' }),
    ]);

    res.status(200).json({
      totalUsers,
      totalListings,
      pendingRequests,
    });
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

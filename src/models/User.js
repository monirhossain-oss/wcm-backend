import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ['user', 'creator', 'admin'],
      default: 'user',
    },
    status: {
      type: String,
      enum: ['active', 'blocked'],
      default: 'active',
    },
    creatorRequest: {
      isApplied: { type: Boolean, default: false },
      appliedAt: { type: Date },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'needs_review'],
        default: 'pending',
      },
      rejectionReason: { type: String, default: '' },
      adminComment: { type: String, default: '' },
    },
    profile: {
      displayName: { type: String },
      bio: { type: String },
      profileImage: { type: String },
      coverImage: { type: String },
      country: { type: String },
      city: { type: String },
      language: { type: String },
      websiteLink: { type: String },
      socialLink: { type: String },
    },
    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    dashboardStats: {
      lastUpdated: { type: Date },
      data: { type: Object },
    },
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);
export default User;

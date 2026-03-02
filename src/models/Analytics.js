import mongoose from 'mongoose';

const analyticsSchema = new mongoose.Schema(
  {
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    views: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
  },
  { timestamps: true }
);

analyticsSchema.index({ listingId: 1, date: 1 }, { unique: true });
analyticsSchema.index({ creatorId: 1, date: 1 });

const Analytics = mongoose.model('Analytics', analyticsSchema);
export default Analytics;

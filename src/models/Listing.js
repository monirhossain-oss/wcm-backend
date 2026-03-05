import mongoose from 'mongoose';

const listingSchema = new mongoose.Schema(
  {
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    externalUrls: [{ type: String, trim: true }],
    websiteLink: { type: String, trim: true },
    region: { type: String, required: true },
    country: { type: String, required: true },
    tradition: { type: String, required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    culturalTags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tag' }],
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionReason: { type: String, trim: true, default: '' },
    image: { type: String, required: true },
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    promotion: {
      level: { type: Number, default: 0 },
      boost: {
        isActive: { type: Boolean, default: false },
        expiresAt: { type: Date },
        amountPaid: { type: Number, default: 0 },
      },
      ppc: {
        isActive: { type: Boolean, default: false },
        ppcBalance: { type: Number, default: 0 },
        costPerClick: { type: Number, default: 0.1 },
        totalClicks: { type: Number, default: 0 },
        amountPaid: { type: Number, default: 0 },
      },
    },
    isPromoted: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
  },
  { timestamps: true }
);

listingSchema.index({
  title: 'text',
  description: 'text',
  country: 'text',
  region: 'text',
  tradition: 'text',
});

listingSchema.index({ isPromoted: 1 });
listingSchema.index({ status: 1 });
listingSchema.index({ 'promotion.boost.isActive': 1, 'promotion.boost.expiresAt': 1 });
listingSchema.index({ 'promotion.ppc.isActive': 1, 'promotion.ppc.ppcBalance': 1 });

const Listing = mongoose.model('Listing', listingSchema);
export default Listing;

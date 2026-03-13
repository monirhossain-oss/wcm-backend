import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
    stripeSessionId: {
      type: String,
      unique: true,
      sparse: true, 
      default: null,
    },
    amountPaid: { type: Number, required: true },
    currency: { type: String, required: true, default: 'EUR' },
    fxRate: { type: Number, default: 1 },
    amountInEUR: { type: Number, required: true },
    packageType: {
      type: String,
      enum: ['boost', 'ppc', 'wallet_topup', 'refund_boost', 'refund_ppc'],
      required: true,
    },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    vatAmount: { type: Number, default: 0 },
    invoiceNumber: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model('Transaction', transactionSchema);
